import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, FindOptionsWhere, In, Repository } from 'typeorm';
import { Account, AccountStatus } from '../accounts/entities/account.entity';
import { AuditRequestContext } from '../audit/audit-request-context';
import { AuditService } from '../audit/audit.service';
import { normalizeMoney } from '../common/money';
import { LedgerService } from '../ledger/ledger.service';
import {
  TransactionDirection,
  TransactionQueryDto,
} from './dto/transaction-query.dto';
import { ReverseTransactionDto } from './dto/reverse-transaction.dto';
import { TransferDto } from './dto/transfer.dto';
import {
  Transaction,
  TransactionStatus,
  TransactionType,
} from './entities/transaction.entity';
import { TransactionStateService } from './transaction-state.service';
import { BankingOperationsService } from './banking-operations.service';

@Injectable()
export class TransactionsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly transactionStateService: TransactionStateService,
    private readonly ledgerService: LedgerService,
    private readonly auditService: AuditService,
    @InjectRepository(Transaction)
    private readonly transactionRepo: Repository<Transaction>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    private readonly operations: BankingOperationsService,
  ) {}

  async transfer(
    userId: string,
    dto: TransferDto,
    idempotencyKey: string,
    auditContext?: AuditRequestContext,
  ) {
    return this.operations.start(
      userId,
      dto,
      idempotencyKey,
      TransactionType.TRANSFER,
      auditContext,
    );
  }

  async getHistory(userId: string, query: TransactionQueryDto) {
    const account = await this.accountRepo.findOne({ where: { userId } });
    if (!account) {
      throw new NotFoundException('Người dùng chưa có tài khoản');
    }

    const outgoing: FindOptionsWhere<Transaction> = {
      fromAccountId: account.id,
    };
    const incoming: FindOptionsWhere<Transaction> = {
      toAccountId: account.id,
    };
    const where =
      query.direction === TransactionDirection.OUTGOING
        ? outgoing
        : query.direction === TransactionDirection.INCOMING
          ? incoming
          : [outgoing, incoming];

    const [transactions, total] = await this.transactionRepo.findAndCount({
      where,
      relations: {
        fromAccount: true,
        toAccount: true,
        reversalTransactions: true,
      },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return {
      items: transactions.map((transaction) => ({
        id: transaction.id,
        direction:
          transaction.fromAccountId === account.id ? 'outgoing' : 'incoming',
        fromAccountNumber: transaction.fromAccount?.accountNumber ?? null,
        toAccountNumber: transaction.toAccount?.accountNumber ?? null,
        amount: normalizeMoney(transaction.amount),
        type: transaction.type,
        status: transaction.status,
        originalTransactionId: transaction.originalTransactionId,
        reversalTransactionId:
          transaction.reversalTransactions?.[0]?.id ?? null,
        description: transaction.description,
        createdAt: transaction.createdAt,
        completedAt: transaction.completedAt,
        reversedAt: transaction.reversedAt,
      })),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async reverseTransaction(
    actorUserId: string,
    transactionId: string,
    dto: ReverseTransactionDto,
    auditContext?: AuditRequestContext,
  ) {
    const reason = dto.reason.trim();

    return this.dataSource.transaction('READ COMMITTED', async (manager) => {
      const accounts = manager.getRepository(Account);
      const transactions = manager.getRepository(Transaction);

      const original = await transactions.findOne({
        where: { id: transactionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!original) {
        throw new NotFoundException('Giao dịch gốc không tồn tại');
      }

      const existingReversal = await transactions.findOne({
        where: { originalTransactionId: original.id },
      });

      this.assertCanReverseOriginalTransaction(
        original,
        Boolean(existingReversal),
      );

      if (!original.fromAccountId || !original.toAccountId) {
        throw new BadRequestException(
          'Giao dịch gốc không đủ thông tin tài khoản để hoàn tiền',
        );
      }

      const lockedAccounts = await accounts.find({
        where: { id: In([original.fromAccountId, original.toAccountId]) },
        order: { id: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });
      const originalSource = lockedAccounts.find(
        (account) => account.id === original.fromAccountId,
      );
      const originalDestination = lockedAccounts.find(
        (account) => account.id === original.toAccountId,
      );
      if (!originalSource || !originalDestination) {
        throw new NotFoundException(
          'Tài khoản trong giao dịch gốc không còn tồn tại',
        );
      }
      for (const account of [originalSource, originalDestination]) {
        if (account.status && account.status !== AccountStatus.ACTIVE)
          throw new BadRequestException(
            'Tài khoản phải ở trạng thái ACTIVE để hoàn tiền',
          );
      }
      if (originalSource.currency !== originalDestination.currency)
        throw new BadRequestException('Hai tài khoản phải cùng loại tiền tệ');

      const reversalTransaction = await transactions.save(
        transactions.create({
          fromAccountId: originalDestination.id,
          toAccountId: originalSource.id,
          fromAccount: originalDestination,
          toAccount: originalSource,
          amount: normalizeMoney(original.amount),
          type: TransactionType.REVERSAL,
          status: TransactionStatus.PENDING,
          originalTransactionId: original.id,
          description: reason,
          idempotencyKey: randomUUID(),
        }),
      );

      await this.ledgerService.recordReversal(
        {
          transaction: reversalTransaction,
          originalSourceAccount: originalSource,
          originalDestinationAccount: originalDestination,
          amount: original.amount,
          originalSourceBalanceBefore: originalSource.balance,
          originalDestinationBalanceBefore: originalDestination.balance,
        },
        manager,
      );

      const completedReversal = await this.transactionStateService.transition(
        reversalTransaction,
        TransactionStatus.COMPLETED,
        manager,
      );
      const originalStatusBeforeReversal = original.status;
      const reversedOriginal = await this.transactionStateService.transition(
        original,
        TransactionStatus.REVERSED,
        manager,
      );
      await manager.query(
        'UPDATE transactions SET original_transaction_id = $1 WHERE id = $2',
        [original.id, completedReversal.id],
      );
      completedReversal.originalTransactionId = original.id;

      completedReversal.fromAccount = originalDestination;
      completedReversal.toAccount = originalSource;
      completedReversal.reversalTransactions = [];
      reversedOriginal.fromAccount = originalSource;
      reversedOriginal.toAccount = originalDestination;
      reversedOriginal.reversalTransactions = [completedReversal];

      await this.auditService.logInTransaction(
        'transaction.reversal.completed',
        {
          actorId: actorUserId,
          entity: 'Transaction',
          entityId: completedReversal.id,
          ...auditContext,
          afterData: {
            transactionId: completedReversal.id,
            originalTransactionId: reversedOriginal.id,
            fromAccountId: completedReversal.fromAccountId,
            toAccountId: completedReversal.toAccountId,
            amount: normalizeMoney(completedReversal.amount),
            status: completedReversal.status,
          },
        },
        manager,
      );
      await this.auditService.logInTransaction(
        'transaction.mark_reversed',
        {
          actorId: actorUserId,
          entity: 'Transaction',
          entityId: reversedOriginal.id,
          ...auditContext,
          beforeData: {
            transactionId: reversedOriginal.id,
            status: originalStatusBeforeReversal,
          },
          afterData: {
            transactionId: reversedOriginal.id,
            status: reversedOriginal.status,
            reversalTransactionId: completedReversal.id,
          },
        },
        manager,
      );

      return {
        originalTransaction: this.toTransactionResult(reversedOriginal),
        reversalTransaction: this.toTransactionResult(completedReversal),
      };
    });
  }

  private assertCanReverseOriginalTransaction(
    transaction: Transaction,
    hasExistingReversal: boolean,
  ): void {
    if (transaction.type !== TransactionType.TRANSFER) {
      throw new BadRequestException(
        'Chỉ có thể hoàn tiền giao dịch chuyển khoản gốc',
      );
    }

    if (transaction.status === TransactionStatus.REVERSED) {
      throw new ConflictException('Giao dịch đã được hoàn tiền');
    }

    if (transaction.status !== TransactionStatus.COMPLETED) {
      throw new ConflictException('Chỉ có thể hoàn tiền giao dịch đã hoàn tất');
    }

    if (hasExistingReversal) {
      throw new ConflictException('Giao dịch đã được hoàn tiền');
    }
  }

  private toTransactionResult(transaction: Transaction) {
    return {
      id: transaction.id,
      fromAccountNumber: transaction.fromAccount?.accountNumber ?? null,
      toAccountNumber: transaction.toAccount?.accountNumber ?? null,
      amount: normalizeMoney(transaction.amount),
      status: transaction.status,
      originalTransactionId: transaction.originalTransactionId,
      reversalTransactionId: transaction.reversalTransactions?.[0]?.id ?? null,
      description: transaction.description,
      createdAt: transaction.createdAt,
      completedAt: transaction.completedAt,
      reversedAt: transaction.reversedAt,
    };
  }
}
