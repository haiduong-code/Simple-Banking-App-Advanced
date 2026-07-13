import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, FindOptionsWhere, In, Repository } from 'typeorm';
import { Account } from '../accounts/entities/account.entity';
import { AuditRequestContext } from '../audit/audit-request-context';
import { AuditService } from '../audit/audit.service';
import {
  MAX_MONEY_MINOR_UNITS,
  minorUnitsToMoney,
  moneyToMinorUnits,
  normalizeMoney,
} from '../common/money';
import { LedgerService } from '../ledger/ledger.service';
import { User, UserStatus } from '../users/entities/user.entity';
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
  ) {}

  async transfer(
    userId: string,
    dto: TransferDto,
    idempotencyKey: string,
    auditContext?: AuditRequestContext,
  ) {
    const normalizedAmount = normalizeMoney(dto.amount);
    const description = dto.description?.trim() || null;

    const previous = await this.findByIdempotencyKey(idempotencyKey);
    if (previous) {
      this.assertSameRequest(
        previous,
        userId,
        dto.toAccountNumber,
        normalizedAmount,
        description,
      );
      return this.toTransferResult(previous);
    }

    return this.dataSource.transaction('READ COMMITTED', async (manager) => {
      const accounts = manager.getRepository(Account);
      const transactions = manager.getRepository(Transaction);
      const users = manager.getRepository(User);

      const sourceCandidate = await accounts.findOne({ where: { userId } });
      if (!sourceCandidate) {
        throw new NotFoundException('Người dùng chưa có tài khoản nguồn');
      }

      const destinationCandidate = await accounts.findOne({
        where: { accountNumber: dto.toAccountNumber },
      });
      if (!destinationCandidate) {
        throw new NotFoundException('Tài khoản đích không tồn tại');
      }
      if (sourceCandidate.id === destinationCandidate.id) {
        throw new BadRequestException('Không thể chuyển tiền cho chính mình');
      }

      // Khóa theo cùng một thứ tự ID để hai giao dịch ngược chiều không deadlock.
      const lockedAccounts = await accounts.find({
        where: { id: In([sourceCandidate.id, destinationCandidate.id]) },
        order: { id: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });
      const source = lockedAccounts.find(
        (account) => account.id === sourceCandidate.id,
      );
      const destination = lockedAccounts.find(
        (account) => account.id === destinationCandidate.id,
      );
      if (!source || !destination) {
        throw new NotFoundException('Tài khoản không còn tồn tại');
      }

      // Request đồng thời cùng key sẽ chờ lock rồi nhìn thấy giao dịch đầu tiên.
      const duplicate = await transactions.findOne({
        where: { idempotencyKey },
        relations: { fromAccount: true, toAccount: true },
      });
      if (duplicate) {
        this.assertSameRequest(
          duplicate,
          userId,
          dto.toAccountNumber,
          normalizedAmount,
          description,
        );
        return this.toTransferResult(duplicate);
      }

      const destinationOwner = await users.findOne({
        where: { id: destination.userId },
      });
      if (!destinationOwner || destinationOwner.status !== UserStatus.ACTIVE) {
        throw new BadRequestException('Tài khoản đích đang bị khóa');
      }

      const amount = moneyToMinorUnits(normalizedAmount);
      if (amount <= 0n) {
        throw new BadRequestException('Số tiền phải lớn hơn 0');
      }

      const sourceBalance = moneyToMinorUnits(source.balance);
      const destinationBalance = moneyToMinorUnits(destination.balance);
      if (sourceBalance < amount) {
        throw new BadRequestException('Số dư không đủ');
      }
      if (destinationBalance + amount > MAX_MONEY_MINOR_UNITS) {
        throw new UnprocessableEntityException(
          'Số dư tài khoản đích vượt giới hạn cho phép',
        );
      }

      source.balance = minorUnitsToMoney(sourceBalance - amount);
      destination.balance = minorUnitsToMoney(destinationBalance + amount);
      await accounts.save([source, destination]);

      const transaction = await transactions.save(
        transactions.create({
          fromAccountId: source.id,
          toAccountId: destination.id,
          fromAccount: source,
          toAccount: destination,
          amount: normalizedAmount,
          type: TransactionType.TRANSFER,
          status: TransactionStatus.PENDING,
          description,
          idempotencyKey,
        }),
      );

      const completedTransaction =
        await this.transactionStateService.transition(
          transaction,
          TransactionStatus.COMPLETED,
          manager,
        );
      await this.auditService.logInTransaction(
        'transaction.transfer.completed',
        {
          actorId: userId,
          entity: 'Transaction',
          entityId: completedTransaction.id,
          ...auditContext,
          afterData: {
            transactionId: completedTransaction.id,
            fromAccountId: completedTransaction.fromAccountId,
            toAccountId: completedTransaction.toAccountId,
            amount: normalizeMoney(completedTransaction.amount),
            status: completedTransaction.status,
          },
        },
        manager,
      );

      return this.toTransferResult(completedTransaction);
    });
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
        relations: {
          fromAccount: true,
          toAccount: true,
          reversalTransactions: true,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!original) {
        throw new NotFoundException('Giao dịch gốc không tồn tại');
      }

      this.assertCanReverseOriginalTransaction(original);

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
          originalTransaction: original,
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

  private findByIdempotencyKey(key: string): Promise<Transaction | null> {
    return this.transactionRepo.findOne({
      where: { idempotencyKey: key },
      relations: {
        fromAccount: true,
        toAccount: true,
        reversalTransactions: true,
      },
    });
  }

  private assertSameRequest(
    transaction: Transaction,
    userId: string,
    toAccountNumber: string,
    amount: string,
    description: string | null,
  ): void {
    const isSame =
      transaction.fromAccount?.userId === userId &&
      transaction.toAccount?.accountNumber === toAccountNumber &&
      normalizeMoney(transaction.amount) === amount &&
      transaction.description === description;

    if (!isSame) {
      throw new ConflictException(
        'Idempotency-Key đã được dùng cho một yêu cầu khác',
      );
    }
  }

  private assertCanReverseOriginalTransaction(transaction: Transaction): void {
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

    if (transaction.reversalTransactions?.length) {
      throw new ConflictException('Giao dịch đã được hoàn tiền');
    }
  }

  private toTransferResult(transaction: Transaction) {
    return this.toTransactionResult(transaction);
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
