import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Account } from '../accounts/entities/account.entity';
import { AuditService } from '../audit/audit.service';
import { LedgerService } from '../ledger/ledger.service';
import {
  Transaction,
  TransactionStatus,
  TransactionType,
} from './entities/transaction.entity';
import { TransactionStateService } from './transaction-state.service';
import { TransactionsService } from './transactions.service';

describe('TransactionsService reversal', () => {
  let service: TransactionsService;
  let dataSource: { transaction: jest.Mock };
  let transactionRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let accountRepository: { find: jest.Mock };
  let ledgerService: { recordReversal: jest.Mock };
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
    transactionRepository = {
      findOne: jest.fn(),
      create: jest.fn((input: Partial<Transaction>) => ({ ...input })),
      save: jest.fn(async (transaction: Transaction) => {
        if (!transaction.id) {
          transaction.id = '44444444-4444-4444-8444-444444444444';
        }
        return transaction;
      }),
    };
    accountRepository = {
      find: jest.fn(async () => [sourceAccount, destinationAccount]),
    };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === Transaction) {
          return transactionRepository;
        }
        if (entity === Account) {
          return accountRepository;
        }
        throw new Error('Unexpected repository');
      }),
    } as unknown as EntityManager;

    dataSource = {
      transaction: jest.fn(async (_isolation, callback) => callback(manager)),
    };
    ledgerService = {
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
      {} as Repository<Transaction>,
      {} as Repository<Account>,
    );
  });

  it('creates a reversal transaction and marks the original reversed', async () => {
    const original = makeOriginal();
    transactionRepository.findOne.mockResolvedValue(original);

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
    transactionRepository.findOne.mockResolvedValue(
      makeOriginal({ type: TransactionType.OPENING_BALANCE }),
    );

    await expect(
      service.reverseTransaction('actor-user-id', 'transaction-id', {
        reason: 'Invalid reversal',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ledgerService.recordReversal).not.toHaveBeenCalled();
  });

  it('rejects transactions that are not completed', async () => {
    transactionRepository.findOne.mockResolvedValue(
      makeOriginal({ status: TransactionStatus.PENDING }),
    );

    await expect(
      service.reverseTransaction('actor-user-id', 'transaction-id', {
        reason: 'Too early',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(ledgerService.recordReversal).not.toHaveBeenCalled();
  });

  it('rejects reversing the same transaction twice', async () => {
    transactionRepository.findOne.mockResolvedValue(
      makeOriginal({
        reversalTransactions: [
          makeOriginal({
            id: '55555555-5555-4555-8555-555555555555',
            type: TransactionType.REVERSAL,
          }),
        ],
      }),
    );

    await expect(
      service.reverseTransaction('actor-user-id', 'transaction-id', {
        reason: 'Duplicate reversal',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(ledgerService.recordReversal).not.toHaveBeenCalled();
  });
});
