import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import {
  DataSource,
  EntityManager,
  FindOptionsWhere,
  Repository,
} from 'typeorm';
import { AccountHistory } from '../accounts/entities/account-history.entity';
import { Account } from '../accounts/entities/account.entity';
import { AuditRequestContext } from '../audit/audit-request-context';
import { AuditService } from '../audit/audit.service';
import { UpdateMeDto } from './dto/update-me.dto';
import { UserHistoryQueryDto } from './dto/user-history-query.dto';
import { UserHistory } from './entities/user-history.entity';
import { User } from './entities/user.entity';

const BCRYPT_SALT_ROUNDS = 10;

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserHistory)
    private readonly userHistoryRepo: Repository<UserHistory>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  findByEmail(email: string): Promise<User | null> {
    return this.userRepo.findOne({
      where: { email: email.trim().toLowerCase() },
    });
  }

  async findById(id: string): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }
    return user;
  }

  /**
   * Tạo user mới: hash mật khẩu bằng bcrypt, không lưu plaintext.
   * Ném ConflictException nếu email đã tồn tại.
   */
  async create(
    input: {
      fullName: string;
      email: string;
      password: string;
    },
    manager?: EntityManager,
  ): Promise<User> {
    const userRepo = manager?.getRepository(User) ?? this.userRepo;
    const email = input.email.trim().toLowerCase();
    const existed = await userRepo.findOne({
      where: { email },
      withDeleted: true,
    });
    if (existed) {
      throw new ConflictException('Email đã được sử dụng');
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_SALT_ROUNDS);
    const user = userRepo.create({
      fullName: input.fullName,
      email,
      passwordHash,
    });
    return userRepo.save(user);
  }

  /** So khớp mật khẩu plaintext với hash đã lưu. */
  comparePassword(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }

  async updateProfile(
    userId: string,
    dto: UpdateMeDto,
    actorId: string | null,
    auditContext?: AuditRequestContext,
  ) {
    const hasFullName = typeof dto.fullName === 'string';
    const hasEmail = typeof dto.email === 'string';
    const hasPhone = typeof dto.phone === 'string';
    if (!hasFullName && !hasEmail && !hasPhone) {
      throw new BadRequestException(
        'Cần cung cấp fullName, email hoặc phone để cập nhật',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(User);
      const historyRepo = manager.getRepository(UserHistory);
      const user = await userRepo.findOne({
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) {
        throw new NotFoundException('Không tìm thấy người dùng');
      }

      const nextEmail = dto.email?.trim().toLowerCase();
      if (nextEmail && nextEmail !== user.email) {
        const existed = await userRepo.findOne({
          where: { email: nextEmail },
          withDeleted: true,
        });
        if (existed && existed.id !== user.id) {
          throw new ConflictException('Email đã được sử dụng');
        }
      }

      const beforeData = this.toUserHistorySnapshot(user);
      let changed = false;

      if (hasFullName && dto.fullName !== user.fullName) {
        user.fullName = dto.fullName!;
        changed = true;
      }
      if (nextEmail && nextEmail !== user.email) {
        user.email = nextEmail;
        changed = true;
      }
      if (hasPhone && (dto.phone || null) !== user.phone) {
        user.phone = dto.phone || null;
        changed = true;
      }

      if (!changed) {
        return this.toUserResult(user);
      }

      const savedUser = await userRepo.save(user);
      const afterData = this.toUserHistorySnapshot(savedUser);

      const linkedAccounts = await manager
        .getRepository(Account)
        .find({ where: { userId } });
      for (const account of linkedAccounts) {
        await manager.getRepository(AccountHistory).save({
          accountId: account.id,
          changedById: actorId,
          action: 'owner_profile_change',
          beforeData,
          afterData,
        });
      }

      await historyRepo.save(
        historyRepo.create({
          userId: savedUser.id,
          changedById: actorId,
          action: 'update_profile',
          beforeData,
          afterData,
        }),
      );

      await this.auditService.logInTransaction(
        'user.update',
        {
          actorId,
          entity: 'User',
          entityId: savedUser.id,
          ...auditContext,
          beforeData,
          afterData,
        },
        manager,
      );

      return this.toUserResult(savedUser);
    });
  }

  async findHistory(userId: string, query: UserHistoryQueryDto) {
    const where: FindOptionsWhere<UserHistory> = { userId };
    if (query.action) {
      where.action = query.action;
    }

    const [items, total] = await this.userHistoryRepo.findAndCount({
      where,
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return {
      items,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async softDeleteUser(
    userId: string,
    actorId: string | null,
    auditContext?: AuditRequestContext,
    manager?: EntityManager,
  ): Promise<void> {
    const run = async (entityManager: EntityManager) => {
      const userRepo = entityManager.getRepository(User);
      const accountRepo = entityManager.getRepository(Account);
      const userHistoryRepo = entityManager.getRepository(UserHistory);
      const accountHistoryRepo = entityManager.getRepository(AccountHistory);
      const user = await userRepo.findOne({ where: { id: userId } });
      if (!user) {
        throw new NotFoundException('Không tìm thấy người dùng');
      }

      const accounts = await accountRepo.find({ where: { userId: user.id } });
      const deletedAt = new Date();
      const userBeforeData = this.toAuditSnapshot(user);
      const accountBeforeData = accounts.map((account) =>
        this.toAccountAuditSnapshot(account),
      );

      for (const account of accounts) {
        account.deletedAt = deletedAt;
      }
      if (accounts.length) {
        await accountRepo.save(accounts);
      }

      user.deletedAt = deletedAt;
      await userRepo.save(user);

      await userHistoryRepo.save(
        userHistoryRepo.create({
          userId: user.id,
          changedById: actorId,
          action: 'soft_delete',
          beforeData: {
            ...userBeforeData,
            accounts: accountBeforeData,
          },
          afterData: {
            ...this.toUserHistorySnapshot(user),
            accounts: accounts.map((account) =>
              this.toAccountHistorySnapshot(account),
            ),
          },
        }),
      );

      for (const account of accounts) {
        await accountHistoryRepo.save(
          accountHistoryRepo.create({
            accountId: account.id,
            changedById: actorId,
            action: 'soft_delete',
            beforeData: accountBeforeData.find(
              (snapshot) => snapshot.accountId === account.id,
            ),
            afterData: this.toAccountHistorySnapshot(account),
          }),
        );
      }

      await this.auditService.logInTransaction(
        'user.soft_delete',
        {
          actorId,
          entity: 'User',
          entityId: user.id,
          ...auditContext,
          beforeData: {
            ...userBeforeData,
            accounts: accountBeforeData,
          },
          afterData: {
            ...this.toAuditSnapshot(user),
            accounts: accounts.map((account) =>
              this.toAccountAuditSnapshot(account),
            ),
          },
        },
        entityManager,
      );

      for (const account of accounts) {
        await this.auditService.logInTransaction(
          'account.soft_delete',
          {
            actorId,
            entity: 'Account',
            entityId: account.id,
            ...auditContext,
            beforeData: accountBeforeData.find(
              (snapshot) => snapshot.accountId === account.id,
            ),
            afterData: this.toAccountAuditSnapshot(account),
          },
          entityManager,
        );
      }
    };

    if (manager) {
      await run(manager);
      return;
    }

    await this.dataSource.transaction(run);
  }

  private toAuditSnapshot(user: User) {
    return this.toUserHistorySnapshot(user);
  }

  private toUserHistorySnapshot(user: User) {
    return {
      userId: user.id,
      email: user.email,
      phone: user.phone,
      fullName: user.fullName,
      role: user.role,
      status: user.status,
      deletedAt: user.deletedAt,
    };
  }

  private toAccountAuditSnapshot(account: Account) {
    return this.toAccountHistorySnapshot(account);
  }

  private toAccountHistorySnapshot(account: Account) {
    return {
      accountId: account.id,
      userId: account.userId,
      accountNumber: account.accountNumber,
      currency: account.currency,
      balance: account.balance,
      deletedAt: account.deletedAt,
    };
  }

  private toUserResult(user: User) {
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      deletedAt: user.deletedAt,
    };
  }
}
