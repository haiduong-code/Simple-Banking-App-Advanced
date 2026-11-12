import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Account } from '../accounts/entities/account.entity';
import { AuditService } from '../audit/audit.service';
import { LedgerService } from '../ledger/ledger.service';
import { User, UserStatus } from '../users/entities/user.entity';
import {
  Transaction,
  TransactionStatus,
  TransactionType,
} from './entities/transaction.entity';
import { TransactionStateService } from './transaction-state.service';
import { TransactionsService } from './transactions.service';
import { BankingOperationsService } from './banking-operations.service';
import { TransactionDirection } from './dto/transaction-query.dto';

describe('TransactionsService reversal', () => {
  let service: TransactionsService;
  let dataSource: { transaction: jest.Mock };
  let manager: { getRepository: jest.Mock; query: jest.Mock };
  let publicTransactionRepository: { findOne: jest.Mock };
  let transactionRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let accountRepository: {
    findOne: jest.Mock;
    find: jest.Mock;
  };
  let userRepository: { findOne: jest.Mock };
  let ledgerService: { recordTransfer: jest.Mock; recordReversal: jest.Mock };
  let auditService: { logInTransaction: jest.Mock };

  const sourceAccount = {
    id: '11111111-1111-4111-8111-111111111111',
    userId: 'sender-user-id',
    accountNumber: '9000000001',
    balance: '900.00',
  } as Account;

  const destinationAccount = {
    id: '22222222-2222-4222-8222-222222222222',
    userId: 'receiver-user-id',
    accountNumber: '9000000002',
    balance: '600.00',
  } as Account;

  function makeOriginal(overrides: Partial<Transaction> = {}): Transaction {
    return {
      id: '33333333-3333-4333-8333-333333333333',
      fromAccountId: sourceAccount.id,
      toAccountId: destinationAccount.id,
      fromAccount: sourceAccount,
      toAccount: destinationAccount,
      amount: '100.00',
      type: TransactionType.TRANSFER,
      status: TransactionStatus.COMPLETED,
      description: 'Original transfer',
      originalTransactionId: null,
      reversalTransactions: [],
      completedAt: new Date('2026-07-10T00:00:00.000Z'),
      reversedAt: null,
      createdAt: new Date('2026-07-10T00:00:00.000Z'),
      ...overrides,
    } as Transaction;
  }

  beforeEach(() => {
    publicTransactionRepository = {
      findOne: jest.fn(async () => null),
    };
    transactionRepository = {
      findOne: jest.fn(async () => null),
      create: jest.fn((input: Partial<Transaction>) => ({ ...input })),
      save: jest.fn(async (transaction: Transaction) => {
        if (!transaction.id) {
          transaction.id = '44444444-4444-4444-8444-444444444444';
        }
        return transaction;
      }),
    };
    accountRepository = {
      findOne: jest.fn(async ({ where }) => {
        if (where?.userId === sourceAccount.userId) {
          return sourceAccount;
        }
        if (where?.accountNumber === destinationAccount.accountNumber) {
          return destinationAccount;
        }
        return null;
      }),
      find: jest.fn(async () => [sourceAccount, destinationAccount]),
    };
    userRepository = {
      findOne: jest.fn(async () => ({ status: UserStatus.ACTIVE })),
    };
    manager = {
      getRepository: jest.fn((entity) => {
        if (entity === Transaction) {
          return transactionRepository;
        }
        if (entity === Account) {
          return accountRepository;
        }
        if (entity === User) {
          return userRepository;
        }
        throw new Error('Unexpected repository');
      }),
      query: jest.fn(async () => undefined),
    };

    dataSource = {
      transaction: jest.fn(async (_isolation, callback) =>
        callback(manager as unknown as EntityManager),
      ),
    };
    ledgerService = {
      recordTransfer: jest.fn(async () => ({})),
      recordReversal: jest.fn(async () => ({})),
    };
    auditService = {
      logInTransaction: jest.fn(async () => undefined),
    };

    service = new TransactionsService(
      dataSource as unknown as DataSource,
      new TransactionStateService(),
      ledgerService as unknown as LedgerService,
      auditService as unknown as AuditService,
      publicTransactionRepository as unknown as Repository<Transaction>,
      {} as Repository<Account>,
      {} as BankingOperationsService,
    );
  });

  it('creates a reversal transaction and marks the original reversed', async () => {
    const original = makeOriginal();
    transactionRepository.findOne
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(null);

    const result = await service.reverseTransaction(
      'actor-user-id',
      original.id,
      { reason: 'Customer requested refund' },
    );

    expect(transactionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        fromAccountId: destinationAccount.id,
        toAccountId: sourceAccount.id,
        amount: '100.00',
        type: TransactionType.REVERSAL,
        status: TransactionStatus.PENDING,
        originalTransactionId: original.id,
        description: 'Customer requested refund',
      }),
    );
    expect(transactionRepository.create.mock.calls[0][0]).not.toHaveProperty(
      'originalTransaction',
    );
    expect(transactionRepository.findOne).toHaveBeenNthCalledWith(1, {
      where: { id: original.id },
      lock: { mode: 'pessimistic_write' },
    });
    expect(transactionRepository.findOne).toHaveBeenNthCalledWith(2, {
      where: { originalTransactionId: original.id },
    });
    expect(ledgerService.recordReversal).toHaveBeenCalledWith(
      expect.objectContaining({
        transaction: expect.objectContaining({
          id: '44444444-4444-4444-8444-444444444444',
        }),
        originalSourceAccount: sourceAccount,
        originalDestinationAccount: destinationAccount,
        amount: '100.00',
        originalSourceBalanceBefore: '900.00',
        originalDestinationBalanceBefore: '600.00',
      }),
      expect.any(Object),
    );
    expect(manager.query).toHaveBeenCalledWith(
      'UPDATE transactions SET original_transaction_id = $1 WHERE id = $2',
      [original.id, '44444444-4444-4444-8444-444444444444'],
    );
    expect(result.originalTransaction.status).toBe(TransactionStatus.REVERSED);
    expect(result.originalTransaction.reversalTransactionId).toBe(
      '44444444-4444-4444-8444-444444444444',
    );
    expect(result.reversalTransaction.status).toBe(TransactionStatus.COMPLETED);
    expect(result.reversalTransaction.originalTransactionId).toBe(original.id);
    expect(auditService.logInTransaction).toHaveBeenCalledWith(
      'transaction.reversal.completed',
      expect.objectContaining({
        actorId: 'actor-user-id',
        entity: 'Transaction',
        entityId: '44444444-4444-4444-8444-444444444444',
      }),
      expect.any(Object),
    );
    expect(auditService.logInTransaction).toHaveBeenCalledWith(
      'transaction.mark_reversed',
      expect.objectContaining({
        actorId: 'actor-user-id',
        entity: 'Transaction',
        entityId: original.id,
      }),
      expect.any(Object),
    );
  });

  it('rejects non-transfer transactions', async () => {
    transactionRepository.findOne
      .mockResolvedValueOnce(
        makeOriginal({ type: TransactionType.OPENING_BALANCE }),
      )
      .mockResolvedValueOnce(null);

    await expect(
      service.reverseTransaction('actor-user-id', 'transaction-id', {
        reason: 'Invalid reversal',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ledgerService.recordReversal).not.toHaveBeenCalled();
  });

  it('rejects transactions that are not completed', async () => {
    transactionRepository.findOne
      .mockResolvedValueOnce(
        makeOriginal({ status: TransactionStatus.PENDING }),
      )
      .mockResolvedValueOnce(null);

    await expect(
      service.reverseTransaction('actor-user-id', 'transaction-id', {
        reason: 'Too early',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(ledgerService.recordReversal).not.toHaveBeenCalled();
  });

  it('rejects reversing the same transaction twice', async () => {
    transactionRepository.findOne.mockResolvedValueOnce(makeOriginal());
    transactionRepository.findOne.mockResolvedValueOnce(
      makeOriginal({
        id: '55555555-5555-4555-8555-555555555555',
        type: TransactionType.REVERSAL,
      }),
    );

    await expect(
      service.reverseTransaction('actor-user-id', 'transaction-id', {
        reason: 'Duplicate reversal',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(ledgerService.recordReversal).not.toHaveBeenCalled();
  });

  it.each([
    TransactionDirection.ALL,
    TransactionDirection.INCOMING,
    TransactionDirection.OUTGOING,
  ])('paginates history for %s', async (direction) => {
    const rows = [
      makeOriginal(),
      makeOriginal({
        fromAccountId: destinationAccount.id,
        fromAccount: null,
        toAccount: null,
        reversalTransactions: undefined,
      }),
    ];
    const findAndCount = jest.fn(async () => [rows, 2]);
    const historyService = new TransactionsService(
      dataSource as unknown as DataSource,
      new TransactionStateService(),
      ledgerService as unknown as LedgerService,
      auditService as unknown as AuditService,
      { findAndCount } as unknown as Repository<Transaction>,
      {
        findOne: jest.fn(async () => sourceAccount),
      } as unknown as Repository<Account>,
      {} as BankingOperationsService,
    );
    const result = await historyService.getHistory(sourceAccount.userId, {
      page: 1,
      limit: 10,
      direction,
    });
    expect(result.items[0].direction).toBe('outgoing');
    expect(result.items[1].direction).toBe('incoming');
    expect(result.items[1].fromAccountNumber).toBeNull();
    expect(result.meta.total).toBe(2);
    expect(findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10, skip: 0 }),
    );
  });
  it('rejects missing accounts, missing originals, incomplete facts and already reversed originals', async () => {
    const historyService = new TransactionsService(
      dataSource as unknown as DataSource,
      new TransactionStateService(),
      ledgerService as unknown as LedgerService,
      auditService as unknown as AuditService,
      {} as Repository<Transaction>,
      { findOne: jest.fn(async () => null) } as unknown as Repository<Account>,
      {} as BankingOperationsService,
    );
    await expect(
      historyService.getHistory('missing', {
        page: 1,
        limit: 10,
        direction: TransactionDirection.ALL,
      }),
    ).rejects.toThrow('chưa có tài khoản');
    await expect(
      service.reverseTransaction('admin', 'missing', {
        reason: 'Missing transaction',
      }),
    ).rejects.toThrow('không tồn tại');
    transactionRepository.findOne
      .mockResolvedValueOnce(makeOriginal({ fromAccountId: null }))
      .mockResolvedValueOnce(null);
    await expect(
      service.reverseTransaction('admin', 'id', { reason: 'Missing source' }),
    ).rejects.toThrow('không đủ thông tin');
    transactionRepository.findOne
      .mockResolvedValueOnce(
        makeOriginal({ status: TransactionStatus.REVERSED }),
      )
      .mockResolvedValueOnce(null);
    await expect(
      service.reverseTransaction('admin', 'id', { reason: 'Already reversed' }),
    ).rejects.toThrow('đã được hoàn tiền');
    transactionRepository.findOne
      .mockResolvedValueOnce(makeOriginal())
      .mockResolvedValueOnce(null);
    accountRepository.find.mockResolvedValueOnce([]);
    await expect(
      service.reverseTransaction('admin', 'id', { reason: 'Missing accounts' }),
    ).rejects.toThrow('không còn tồn tại');
  });
});
