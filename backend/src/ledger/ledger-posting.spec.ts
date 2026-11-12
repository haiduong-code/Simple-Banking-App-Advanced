import { EntityManager, Repository } from 'typeorm';
import { Account } from '../accounts/entities/account.entity';
import { OptimisticConflict } from '../common/transaction-retry';
import { Transaction } from '../transactions/entities/transaction.entity';
import {
  LedgerEntry,
  LedgerEntryType as EntryType,
} from './entities/ledger-entry.entity';
import { LedgerService } from './ledger.service';
describe('Ledger posting and balance integrity', () => {
  let service: LedgerService;
  let entries: any;
  let accounts: any;
  let manager: EntityManager;
  let source: Account;
  let destination: Account;
  const tx = { id: 'tx-id', amount: '100.00' } as Transaction;
  beforeEach(() => {
    entries = {
      create: jest.fn((input) => input),
      save: jest.fn(async (entry) => entry),
      count: jest.fn(async () => 0),
      createQueryBuilder: jest.fn(),
    };
    accounts = {
      save: jest.fn(async (value) => value),
      createQueryBuilder: jest.fn(),
    };
    manager = {
      getRepository: (entity: any) =>
        entity === LedgerEntry ? entries : accounts,
    } as EntityManager;
    service = new LedgerService(entries as Repository<LedgerEntry>);
    source = { id: 'a', balance: '500.00', version: 1 } as Account;
    destination = { id: 'b', balance: '200.00', version: 1 } as Account;
  });
  const params = () => ({
    transaction: tx,
    sourceAccount: source,
    destinationAccount: destination,
    amount: '100.00',
    sourceBalanceBefore: source.balance,
    destinationBalanceBefore: destination.balance,
  });
  const reversal = () => ({
    transaction: tx,
    originalSourceAccount: source,
    originalDestinationAccount: destination,
    amount: '100.00',
    originalSourceBalanceBefore: source.balance,
    originalDestinationBalanceBefore: destination.balance,
  });
  it('posts matching debit/credit entries and caches the resulting balances', async () => {
    const result = await service.recordTransfer(params(), manager);
    expect(source.balance).toBe('400.00');
    expect(destination.balance).toBe('300.00');
    expect(result.debitEntry).toMatchObject({
      type: EntryType.DEBIT,
      amount: '100.00',
      balanceAfter: '400.00',
    });
    expect(result.creditEntry).toMatchObject({
      type: EntryType.CREDIT,
      amount: '100.00',
      balanceAfter: '300.00',
    });
    expect(accounts.save).toHaveBeenCalledWith([source, destination]);
  });
  it('posts reversals with the opposite debit/credit while preserving original entries', async () => {
    const result = await service.recordReversal(reversal(), manager);
    expect(result.debitEntry.accountId).toBe(destination.id);
    expect(result.creditEntry.accountId).toBe(source.id);
    expect(source.balance).toBe('600.00');
    expect(destination.balance).toBe('100.00');
  });
  it('requires a persisted transaction, distinct accounts, and a positive amount', async () => {
    await expect(
      service.recordTransfer(
        { ...params(), transaction: {} as Transaction },
        manager,
      ),
    ).rejects.toThrow('saved');
    await expect(
      service.recordReversal(
        { ...reversal(), transaction: {} as Transaction },
        manager,
      ),
    ).rejects.toThrow('saved');
    await expect(
      service.recordTransfer(
        { ...params(), destinationAccount: source },
        manager,
      ),
    ).rejects.toThrow('cùng account');
    await expect(
      service.recordReversal(
        { ...reversal(), originalDestinationAccount: source },
        manager,
      ),
    ).rejects.toThrow('cùng account');
    await expect(
      service.recordTransfer({ ...params(), amount: '0' }, manager),
    ).rejects.toThrow('lớn hơn 0');
    await expect(
      service.recordReversal({ ...reversal(), amount: '0' }, manager),
    ).rejects.toThrow('lớn hơn 0');
  });
  it('rejects overdrafts and recipient overflow for transfers and reversals', async () => {
    await expect(
      service.recordTransfer(
        { ...params(), sourceBalanceBefore: '99.99' },
        manager,
      ),
    ).rejects.toThrow('không đủ');
    await expect(
      service.recordReversal(
        { ...reversal(), originalDestinationBalanceBefore: '99.99' },
        manager,
      ),
    ).rejects.toThrow('không đủ');
    await expect(
      service.recordTransfer(
        { ...params(), destinationBalanceBefore: '9999999999999999.99' },
        manager,
      ),
    ).rejects.toThrow('giới hạn');
    await expect(
      service.recordReversal(
        { ...reversal(), originalSourceBalanceBefore: '9999999999999999.99' },
        manager,
      ),
    ).rejects.toThrow('giới hạn');
    expect(accounts.save).not.toHaveBeenCalled();
    expect(entries.save).not.toHaveBeenCalled();
  });
  it('checks entry positivity and credit/debit equality', async () => {
    await expect(
      service.createEntry(
        {
          accountId: 'a',
          transactionId: 'tx',
          type: EntryType.DEBIT,
          amount: '0',
          balanceAfter: '100',
        },
        manager,
      ),
    ).rejects.toThrow('lớn hơn 0');
    entries.save.mockImplementation(async (entry) => ({
      ...entry,
      amount: entry.type === EntryType.DEBIT ? '99.00' : '100.00',
    }));
    await expect(service.recordTransfer(params(), manager)).rejects.toThrow(
      'do not match',
    );
    await expect(service.recordReversal(reversal(), manager)).rejects.toThrow(
      'do not match',
    );
  });
  it('calculates the account balance from the ledger and checks entry existence', async () => {
    const qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      getRawOne: jest
        .fn()
        .mockResolvedValueOnce({ balance: '200.00' })
        .mockResolvedValueOnce(null),
    };
    entries.createQueryBuilder.mockReturnValue(qb);
    await expect(service.getAccountLedgerBalance('a')).resolves.toBe('200.00');
    await expect(service.getAccountLedgerBalance('a', manager)).resolves.toBe(
      '0.00',
    );
    await expect(service.hasEntriesForAccount('a')).resolves.toBe(false);
    entries.count.mockResolvedValue(1);
    await expect(service.hasEntriesForAccount('a', manager)).resolves.toBe(
      true,
    );
    await expect(
      service.hasEntry({
        accountId: 'a',
        transactionId: 'tx',
        type: EntryType.CREDIT,
      }),
    ).resolves.toBe(true);
    await service.hasEntry(
      { accountId: 'a', transactionId: 'tx', type: EntryType.CREDIT },
      manager,
    );
  });
  it('conditionally updates both balances with their versions, rejecting a stale write', async () => {
    const qb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    accounts.createQueryBuilder.mockReturnValue(qb);
    await service.recordTransfer({ ...params(), optimistic: true }, manager);
    expect(source.version).toBe(2);
    expect(destination.version).toBe(2);
    expect(qb.where.mock.calls[0][1]).toEqual({ id: 'a', version: 1 });
    qb.execute.mockResolvedValue({ affected: 0 });
    await expect(
      service.saveBalances([source], manager, true),
    ).rejects.toBeInstanceOf(OptimisticConflict);
  });
  it('posts cash deposits and withdrawals without allowing a negative balance', async () => {
    await service.recordCash(source, tx, true, manager);
    expect(source.balance).toBe('600.00');
    await service.recordCash(source, tx, false, manager);
    expect(source.balance).toBe('500.00');
    await expect(
      service.recordCash(source, { ...tx, amount: '501.00' }, false, manager),
    ).rejects.toThrow('không đủ');
  });
});
