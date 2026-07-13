import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Account } from '../accounts/entities/account.entity';
import { AccountsService } from '../accounts/accounts.service';
import { AuditRequestContext } from '../audit/audit-request-context';
import { AuditService } from '../audit/audit.service';
import { normalizeMoney } from '../common/money';
import {
  Transaction,
  TransactionStatus,
  TransactionType,
} from '../transactions/entities/transaction.entity';
import { UsersService } from '../users/users.service';
import { UserHistory } from '../users/entities/user-history.entity';
import { User, UserRole, UserStatus } from '../users/entities/user.entity';
import { AdminTransactionsQueryDto } from './dto/admin-transactions-query.dto';
import { AdminUsersQueryDto } from './dto/admin-users-query.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Transaction)
    private readonly transactionRepo: Repository<Transaction>,
    private readonly auditService: AuditService,
    private readonly usersService: UsersService,
    private readonly accountsService: AccountsService,
  ) {}

  async findUsers(query: AdminUsersQueryDto) {
    const queryBuilder = this.userRepo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.accounts', 'account')
      .orderBy('user.createdAt', 'DESC')
      .addOrderBy('user.id', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    if (query.includeDeleted) {
      queryBuilder.withDeleted();
    }
    if (query.status) {
      queryBuilder.andWhere('user.status = :status', {
        status: query.status,
      });
    }
    if (query.role) {
      queryBuilder.andWhere('user.role = :role', { role: query.role });
    }
    if (query.search?.trim()) {
      queryBuilder.andWhere(
        '(LOWER(user.email) LIKE :search OR LOWER(user.fullName) LIKE :search)',
        { search: `%${query.search.trim().toLowerCase()}%` },
      );
    }

    const [users, total] = await queryBuilder.getManyAndCount();

    return {
      items: users.map((user) => this.toAdminUserItem(user)),
      meta: this.toMeta(query.page, query.limit, total),
    };
  }

  async updateUserStatus(
    userId: string,
    dto: UpdateUserStatusDto,
    actorId: string,
    auditContext?: AuditRequestContext,
  ) {
    return this.userRepo.manager.transaction(async (manager) => {
      const userRepo = manager.getRepository(User);
      const historyRepo = manager.getRepository(UserHistory);
      const user = await userRepo.findOne({ where: { id: userId } });
      if (!user) {
        throw new NotFoundException('Không tìm thấy người dùng');
      }

      const beforeData = this.toUserAuditSnapshot(user);
      user.status = dto.status;
      const savedUser = await userRepo.save(user);
      const afterData = this.toUserAuditSnapshot(savedUser);

      await historyRepo.save(
        historyRepo.create({
          userId: savedUser.id,
          changedById: actorId,
          action: 'status_change',
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

      return this.toAdminUserItem(savedUser);
    });
  }

  async softDeleteUser(
    userId: string,
    actorId: string,
    auditContext?: AuditRequestContext,
  ) {
    await this.usersService.softDeleteUser(userId, actorId, auditContext);

    return { deleted: true, userId };
  }

  async softDeleteAccount(
    accountId: string,
    actorId: string,
    auditContext?: AuditRequestContext,
  ) {
    await this.accountsService.softDeleteAccount(
      accountId,
      actorId,
      auditContext,
    );

    return { deleted: true, accountId };
  }

  async findTransactions(query: AdminTransactionsQueryDto) {
    const queryBuilder = this.transactionRepo
      .createQueryBuilder('transaction')
      .leftJoinAndSelect('transaction.fromAccount', 'fromAccount')
      .leftJoinAndSelect('transaction.toAccount', 'toAccount')
      .leftJoinAndSelect(
        'transaction.reversalTransactions',
        'reversalTransaction',
      )
      .orderBy('transaction.createdAt', 'DESC')
      .addOrderBy('transaction.id', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    if (query.type) {
      queryBuilder.andWhere('transaction.type = :type', { type: query.type });
    }
    if (query.status) {
      queryBuilder.andWhere('transaction.status = :status', {
        status: query.status,
      });
    }
    if (query.accountId) {
      queryBuilder.andWhere(
        '(transaction.fromAccountId = :accountId OR transaction.toAccountId = :accountId)',
        { accountId: query.accountId },
      );
    }

    const [transactions, total] = await queryBuilder.getManyAndCount();

    return {
      items: transactions.map((transaction) =>
        this.toAdminTransactionItem(transaction),
      ),
      meta: this.toMeta(query.page, query.limit, total),
    };
  }

  private toAdminUserItem(user: User) {
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role as UserRole,
      status: user.status as UserStatus,
      createdAt: user.createdAt,
      deletedAt: user.deletedAt,
      accounts:
        user.accounts?.map((account) => ({
          id: account.id,
          accountNumber: account.accountNumber,
          balance: normalizeMoney(account.balance),
          currency: account.currency,
          createdAt: account.createdAt,
          deletedAt: account.deletedAt,
        })) ?? [],
    };
  }

  private toAdminTransactionItem(transaction: Transaction) {
    return {
      id: transaction.id,
      fromAccountId: transaction.fromAccountId,
      fromAccountNumber: transaction.fromAccount?.accountNumber ?? null,
      toAccountId: transaction.toAccountId,
      toAccountNumber: transaction.toAccount?.accountNumber ?? null,
      amount: normalizeMoney(transaction.amount),
      type: transaction.type as TransactionType,
      status: transaction.status as TransactionStatus,
      originalTransactionId: transaction.originalTransactionId,
      reversalTransactionId: transaction.reversalTransactions?.[0]?.id ?? null,
      description: transaction.description,
      createdAt: transaction.createdAt,
      completedAt: transaction.completedAt,
      reversedAt: transaction.reversedAt,
    };
  }

  private toUserAuditSnapshot(user: User) {
    return {
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      status: user.status,
      deletedAt: user.deletedAt,
    };
  }

  private toMeta(page: number, limit: number, total: number) {
    return {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }
}
