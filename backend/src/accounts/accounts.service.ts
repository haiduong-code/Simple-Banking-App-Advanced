import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomInt } from 'crypto';
import {
  DataSource,
  EntityManager,
  FindOptionsWhere,
  Repository,
} from 'typeorm';
import { AuditRequestContext } from '../audit/audit-request-context';
import { AuditService } from '../audit/audit.service';
import { AccountHistoryQueryDto } from './dto/account-history-query.dto';
import { AccountHistory } from './entities/account-history.entity';
import { Account } from './entities/account.entity';

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    @InjectRepository(AccountHistory)
    private readonly accountHistoryRepo: Repository<AccountHistory>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Sinh số tài khoản duy nhất (10 chữ số, bắt đầu bằng 9).
   * Lặp tới khi không trùng trong DB.
   */
  private async generateUniqueAccountNumber(
    accountRepo: Repository<Account>,
  ): Promise<string> {
    // Tối đa vài lần thử; xác suất trùng cực thấp.
    for (let i = 0; i < 10; i++) {
      const candidate = '9' + randomInt(100_000_000, 1_000_000_000).toString();
      const existed = await accountRepo.findOne({
        where: { accountNumber: candidate },
        withDeleted: true,
      });
      if (!existed) {
        return candidate;
      }
    }
    throw new Error('Không sinh được số tài khoản duy nhất');
  }

  /**
   * Tạo tài khoản mặc định cho user mới (dùng khi đăng ký).
   * initialBalance chỉ phục vụ demo/seed; mặc định 0.
   */
  async createForUser(
    userId: string,
    initialBalance = '0.00',
    manager?: EntityManager,
  ): Promise<Account> {
    const accountRepo = manager?.getRepository(Account) ?? this.accountRepo;
    const accountNumber = await this.generateUniqueAccountNumber(accountRepo);
    const account = accountRepo.create({
      userId,
      accountNumber,
      balance: initialBalance,
      currency: 'VND',
    });
    return accountRepo.save(account);
  }

  /** Lấy tài khoản theo user (GĐ3: GET /accounts/me). */
  async findByUserId(userId: string): Promise<Account> {
    const account = await this.accountRepo.findOne({ where: { userId } });
    if (!account) {
      throw new NotFoundException('Người dùng chưa có tài khoản');
    }
    return account;
  }

  async softDeleteAccount(
    accountId: string,
    actorId: string | null,
    auditContext?: AuditRequestContext,
    manager?: EntityManager,
  ): Promise<void> {
    const run = async (entityManager: EntityManager) => {
      const accountRepo = entityManager.getRepository(Account);
      const historyRepo = entityManager.getRepository(AccountHistory);
      const account = await accountRepo.findOne({ where: { id: accountId } });
      if (!account) {
        throw new NotFoundException('Không tìm thấy tài khoản');
      }

      const beforeData = this.toAuditSnapshot(account);
      account.deletedAt = new Date();
      await accountRepo.save(account);
      await historyRepo.save(
        historyRepo.create({
          accountId: account.id,
          changedById: actorId,
          action: 'soft_delete',
          beforeData,
          afterData: this.toHistorySnapshot(account),
        }),
      );

      await this.auditService.logInTransaction(
        'account.soft_delete',
        {
          actorId,
          entity: 'Account',
          entityId: account.id,
          ...auditContext,
          beforeData,
          afterData: this.toAuditSnapshot(account),
        },
        entityManager,
      );
    };

    if (manager) {
      await run(manager);
      return;
    }

    await this.dataSource.transaction(run);
  }

  async findHistory(accountId: string, query: AccountHistoryQueryDto) {
    const account = await this.accountRepo.findOne({
      where: { id: accountId },
      withDeleted: true,
    });
    if (!account) {
      throw new NotFoundException('Không tìm thấy tài khoản');
    }

    const where: FindOptionsWhere<AccountHistory> = { accountId };
    if (query.action) {
      where.action = query.action;
    }

    const [items, total] = await this.accountHistoryRepo.findAndCount({
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

  private toAuditSnapshot(account: Account) {
    return this.toHistorySnapshot(account);
  }

  private toHistorySnapshot(account: Account) {
    return {
      accountId: account.id,
      userId: account.userId,
      accountNumber: account.accountNumber,
      currency: account.currency,
      balance: account.balance,
      deletedAt: account.deletedAt,
    };
  }
}
