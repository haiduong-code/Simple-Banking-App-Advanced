import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import {
  Account,
  AccountStatus,
  AccountTier,
} from '../accounts/entities/account.entity';
import { User, UserRole, UserStatus } from '../users/entities/user.entity';
import { AuditService } from '../audit/audit.service';
import { LedgerService } from '../ledger/ledger.service';
import { BankingOperationsService } from './banking-operations.service';
import {
  Transaction,
  TransactionStatus as Status,
  TransactionType as Type,
} from './entities/transaction.entity';
import { IdempotencyKey } from './entities/idempotency-key.entity';
import { TransactionStateService } from './transaction-state.service';
import { OtpDeliveryService } from './otp-delivery.service';

describe('BankingOperationsService with repository mocks', () => {
  let service: BankingOperationsService;
  let source: Account;
  let destination: Account;
  let actor: any;
  let current: any;
  let accounts: any;
  let transactions: any;
  let users: any;
  let keys: any;
  let ledger: any;
  let audit: any;
  let delivery: any;
  let manager: any;
  let qb: any;
  let config: ConfigService;
  const dto = () => ({
    toAccountNumber: destination.accountNumber,
    amount: '100.00',
  });
  beforeEach(() => {
    source = {
      id: randomUUID(),
      userId: randomUUID(),
      accountNumber: '9000000001',
      balance: '50000000.00',
      holdAmount: '0.00',
      status: AccountStatus.ACTIVE,
      tier: AccountTier.STANDARD,
      currency: 'VND',
      version: 1,
    } as Account;
    destination = {
      ...source,
      id: randomUUID(),
      userId: randomUUID(),
      accountNumber: '9000000002',
      balance: '0.00',
    };
    actor = {
      id: source.userId,
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
    };
    current = null;
    qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      getRawOne: jest.fn(async () => ({
        amount: '0',
        recent: '0',
        average: '0',
      })),
      getOne: jest.fn(async () => current),
    };
    accounts = {
      findOneBy: jest.fn(async (where) =>
        where.userId === actor.id ||
        where.accountNumber === source.accountNumber ||
        where.id === source.id
          ? source
          : destination,
      ),
      find: jest.fn(async () => [source, destination]),
      findOneByOrFail: jest.fn(async () => source),
    };
    transactions = {
      exists: jest.fn(async () => false),
      create: jest.fn((input) => input),
      createQueryBuilder: jest.fn(() => qb),
      findOne: jest.fn(async () => current),
      save: jest.fn(async (tx) => {
        tx.id ??= randomUUID();
        tx.createdAt ??= new Date();
        tx.otpAttempts ??= 0;
        current = tx;
        return tx;
      }),
    };
    const records = new Map();
    keys = {
      findOne: jest.fn(async ({ where }) => records.get(where.key) ?? null),
      save: jest.fn(async (key) => records.set(key.key, key)),
    };
    users = {
      findOneBy: jest.fn(async () => actor),
      findOneByOrFail: jest.fn(async () => actor),
      exists: jest.fn(async () => true),
    };
    manager = {
      query: jest.fn(async () => []),
      getRepository: (entity: any) => {
        if (entity === Account) return accounts;
        if (entity === Transaction) return transactions;
        if (entity === User) return users;
        if (entity === IdempotencyKey) return keys;
        throw new Error('Unknown repository');
      },
    };
    const db = {
      transaction: jest.fn(async (_level, callback) => callback(manager)),
      getRepository: manager.getRepository,
    };
    ledger = {
      recordTransfer: jest.fn(async () => ({})),
      recordCash: jest.fn(async () => ({})),
      saveBalances: jest.fn(),
    };
    audit = { logInTransaction: jest.fn() };
    delivery = { deliver: jest.fn() };
    config = new ConfigService({
      JWT_SECRET: 'test-secret',
      BANKING_LOCK_MODE: 'pessimistic',
    });
    service = new BankingOperationsService(
      db as unknown as DataSource,
      new TransactionStateService(),
      ledger as LedgerService,
      audit as AuditService,
      config,
      delivery as OtpDeliveryService,
    );
  });
  const start = (
    service: BankingOperationsService,
    actorId: string,
    payload: any,
    type = Type.TRANSFER,
    key = randomUUID(),
  ) => service.start(actorId, payload, key, type);

  it('posts the transfer through the double-entry service in one transaction', async () => {
    const result = await start(service, actor.id, dto());
    expect(result.status).toBe(Status.COMPLETED);
    expect(ledger.recordTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceAccount: source,
        destinationAccount: destination,
        amount: '100.00',
        sourceBalanceBefore: source.balance,
        destinationBalanceBefore: destination.balance,
      }),
      manager,
    );
    expect(audit.logInTransaction).toHaveBeenCalledWith(
      'transaction.created',
      expect.objectContaining({ actorId: actor.id }),
      manager,
    );
  });
  it('replays the saved response without posting money again, including after status changes', async () => {
    const key = randomUUID();
    const first = await start(service, actor.id, dto(), Type.TRANSFER, key);
    current.status = Status.REVERSED;
    expect(await start(service, actor.id, dto(), Type.TRANSFER, key)).toEqual(
      first,
    );
    expect(ledger.recordTransfer).toHaveBeenCalledTimes(1);
    await expect(
      start(service, actor.id, { ...dto(), amount: '101' }, Type.TRANSFER, key),
    ).rejects.toThrow('Idempotency');
    await expect(
      start(service, randomUUID(), dto(), Type.TRANSFER, key),
    ).rejects.toThrow('Idempotency');
  });
  it('does not re-execute legacy keys, self-transfers or zero amounts', async () => {
    transactions.exists.mockResolvedValueOnce(true);
    await expect(start(service, actor.id, dto())).rejects.toThrow('lịch sử');
    accounts.findOneBy.mockResolvedValue(source);
    await expect(start(service, actor.id, dto())).rejects.toThrow('chính mình');
    await expect(
      start(service, actor.id, { ...dto(), amount: '0' }),
    ).rejects.toThrow('lớn hơn 0');
  });
  it('rejects inactive actors, missing accounts, missing destinations and forbidden sources', async () => {
    users.findOneBy.mockResolvedValueOnce(null);
    await expect(start(service, actor.id, dto())).rejects.toThrow('hoạt động');
    accounts.findOneBy.mockResolvedValueOnce(null);
    await expect(start(service, actor.id, dto())).rejects.toThrow('nguồn');
    accounts.findOneBy
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce(null);
    await expect(start(service, actor.id, dto())).rejects.toThrow('đích');
    accounts.findOneBy.mockResolvedValueOnce(destination);
    await expect(start(service, actor.id, dto())).rejects.toThrow('của mình');
    accounts.find.mockResolvedValueOnce([]);
    await expect(start(service, actor.id, dto())).rejects.toThrow('đóng');
  });
  it('records and replays business failures without posting ledger entries', async () => {
    source.balance = '0.00';
    const key = randomUUID();
    await expect(
      start(service, actor.id, dto(), Type.TRANSFER, key),
    ).rejects.toBeInstanceOf(HttpException);
    expect(current.status).toBe(Status.FAILED);
    expect(keys.save).toHaveBeenCalled();
    await expect(
      start(service, actor.id, dto(), Type.TRANSFER, key),
    ).rejects.toThrow('khả dụng');
    expect(ledger.recordTransfer).not.toHaveBeenCalled();
  });
  it('requires active account owners', async () => {
    users.exists.mockResolvedValue(false);
    await expect(start(service, actor.id, dto())).rejects.toThrow('khóa');
    expect(current.status).toBe(Status.FAILED);
  });
  it('enforces deposit roles and uses cash ledger entries for deposit and withdrawal', async () => {
    await expect(
      start(service, actor.id, { amount: '100' }, Type.DEPOSIT),
    ).rejects.toThrow('nạp tiền');
    actor.role = UserRole.TELLER;
    accounts.find.mockResolvedValue([source]);
    await expect(
      start(service, actor.id, { amount: '100' }, Type.DEPOSIT),
    ).resolves.toMatchObject({ status: Status.COMPLETED });
    expect(ledger.recordCash).toHaveBeenLastCalledWith(
      source,
      expect.anything(),
      true,
      manager,
      false,
    );
    await start(service, actor.id, { amount: '100' }, Type.WITHDRAWAL);
    expect(ledger.recordCash).toHaveBeenLastCalledWith(
      source,
      expect.anything(),
      false,
      manager,
      false,
    );
  });
  it('creates an expiring OTP at the threshold without moving money, then requires approval', async () => {
    config.set('BANKING_LOCK_MODE', 'optimistic');
    const pending = await start(service, actor.id, {
      ...dto(),
      amount: '10000000',
    });
    expect(pending.status).toBe(Status.PENDING_OTP);
    expect(ledger.recordTransfer).not.toHaveBeenCalled();
    expect(ledger.saveBalances).toHaveBeenCalledWith([source], manager, true);
    const [id, owner, code, expiresAt] = delivery.deliver.mock.calls[0];
    expect(owner).toBe(source.userId);
    expect(code).toMatch(/^\d{6}$/);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    await expect(service.verifyOtp(actor.id, id, code)).resolves.toMatchObject({
      status: Status.PENDING_APPROVAL,
    });
    await expect(service.verifyOtp(actor.id, id, code)).rejects.toThrow(
      'không chờ OTP',
    );
  });
  it('persists wrong OTP attempts and terminal failure', async () => {
    await start(service, actor.id, { ...dto(), amount: '10000000' });
    const [id, , code] = delivery.deliver.mock.calls[0];
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++)
      await expect(service.verifyOtp(actor.id, id, wrong)).rejects.toThrow(
        'OTP không đúng',
      );
    expect(current.status).toBe(Status.FAILED);
    expect(current.otpHash).toBeNull();
  });
  it('rejects expired OTP and other owners', async () => {
    await start(service, actor.id, { ...dto(), amount: '10000000' });
    const [id, , code] = delivery.deliver.mock.calls[0];
    await expect(service.verifyOtp(randomUUID(), id, code)).rejects.toThrow(
      'chủ tài khoản',
    );
    current.otpExpiresAt = new Date(0);
    await expect(service.verifyOtp(actor.id, id, code)).rejects.toThrow(
      'hết hạn',
    );
    expect(current.status).toBe(Status.FAILED);
  });
  async function awaitApproval() {
    await start(service, actor.id, { ...dto(), amount: '10000000' });
    const [id, , code] =
      delivery.deliver.mock.calls[delivery.deliver.mock.calls.length - 1];
    await service.verifyOtp(actor.id, id, code);
    return id;
  }
  it('allows admin approval, rechecks available funds, and rejects approval by teller', async () => {
    const id = await awaitApproval();
    actor.role = UserRole.TELLER;
    await expect(service.approve(actor.id, id, true)).rejects.toThrow('admin');
    actor.role = UserRole.ADMIN;
    await expect(service.approve(actor.id, id, true)).resolves.toMatchObject({
      status: Status.COMPLETED,
    });
    await expect(service.approve(actor.id, id, true)).rejects.toThrow(
      'không chờ duyệt',
    );
  });
  it('fails approval when the balance changed, and supports explicit rejection', async () => {
    const id = await awaitApproval();
    actor.role = UserRole.ADMIN;
    source.balance = '0.00';
    await expect(service.approve(actor.id, id, true)).resolves.toMatchObject({
      status: Status.FAILED,
    });
    source.balance = '50000000.00';
    const next = await awaitApproval();
    actor.role = UserRole.ADMIN;
    await expect(service.approve(actor.id, next, false)).resolves.toMatchObject(
      { status: Status.FAILED },
    );
  });
  it('rolls back the posting savepoint and propagates unexpected faults', async () => {
    ledger.recordTransfer.mockRejectedValue(new Error('DB unavailable'));
    await expect(start(service, actor.id, dto())).rejects.toThrow(
      'DB unavailable',
    );
    expect(manager.query).toHaveBeenCalledWith(
      'ROLLBACK TO SAVEPOINT movement',
    );
    expect(keys.save).not.toHaveBeenCalled();
  });
  it('flags rapid activity and an unusually large amount without refusing the transfer', async () => {
    qb.getRawOne.mockResolvedValue({ amount: '0', recent: '5', unusual: true });
    await expect(start(service, actor.id, dto())).resolves.toMatchObject({
      status: Status.COMPLETED,
      reviewRequired: true,
    });
    expect(current.reviewReasons).toHaveLength(2);
  });
  it('enforces detail visibility and missing transaction handling', async () => {
    await expect(service.getForUser(actor.id, randomUUID())).rejects.toThrow(
      'Không tìm thấy',
    );
    const created = await start(service, actor.id, dto());
    await expect(
      service.getForUser(actor.id, created.id),
    ).resolves.toMatchObject({ id: created.id });
    actor.id = randomUUID();
    await expect(service.getForUser(actor.id, created.id)).rejects.toThrow(
      'quyền',
    );
    actor.role = UserRole.ADMIN;
    await expect(
      service.getForUser(actor.id, created.id),
    ).resolves.toMatchObject({ id: created.id });
    current = null;
    await expect(
      service.verifyOtp(actor.id, randomUUID(), '123456'),
    ).rejects.toThrow('Không tìm thấy');
  });
});
