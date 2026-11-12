import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getStorageToken, ThrottlerStorageService } from '@nestjs/throttler';
import request = require('supertest');
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Account } from '../src/accounts/entities/account.entity';
import { User, UserRole } from '../src/users/entities/user.entity';
import {
  LedgerEntry,
  LedgerEntryType,
} from '../src/ledger/entities/ledger-entry.entity';
import { LedgerService } from '../src/ledger/ledger.service';
import {
  Transaction,
  TransactionStatus as Status,
} from '../src/transactions/entities/transaction.entity';
import { MonitoringService } from '../src/monitoring/monitoring.service';

describe('Banking API with isolated PostgreSQL', () => {
  let app: INestApplication;
  let db: DataSource;
  let client: ReturnType<typeof request>;
  const password = 'Test@12345';

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    db = app.get(DataSource);
    client = request(app.getHttpServer());
  });
  afterAll(async () => {
    if (app) await app.close();
  });
  beforeEach(async () => {
    jest.restoreAllMocks();
    // Clear both counters and their expiry queues so each case has an independent rate window.
    app.get<ThrottlerStorageService>(getStorageToken()).onApplicationShutdown();
    app.get(ConfigService).set('BANKING_LOCK_MODE', 'pessimistic');
    await db.query(
      'TRUNCATE ledger_entries, transactions, accounts, users, idempotency_keys, refresh_sessions, audit_logs, user_history, account_history, reconciliation_reports CASCADE',
    );
  });

  async function user(role = UserRole.CUSTOMER, balance = '1000000.00') {
    const email = `${randomUUID()}@bank.test`;
    const registered = await client
      .post('/auth/register')
      .send({ fullName: 'Integration User', email, password })
      .expect(201);
    const id = registered.body.user.id;
    if (role !== UserRole.CUSTOMER)
      await db.getRepository(User).update(id, { role });
    const account = await db
      .getRepository(Account)
      .findOneByOrFail({ userId: id });
    if (balance !== '0.00') {
      const tx = await db.getRepository(Transaction).save({
        toAccountId: account.id,
        amount: balance,
        idempotencyKey: randomUUID(),
        type: 'opening_balance' as any,
        status: Status.COMPLETED,
        completedAt: new Date(),
      });
      await db.getRepository(Account).update(account.id, { balance });
      await db.getRepository(LedgerEntry).save({
        accountId: account.id,
        transactionId: tx.id,
        type: 'credit' as any,
        amount: balance,
        balanceAfter: balance,
      });
    }
    return {
      ...registered.body,
      id,
      email,
      account: { ...account, balance } as Account,
    };
  }
  function transfer(from: any, to: any, amount = '100.00', key = randomUUID()) {
    return client
      .post('/transactions/transfer')
      .auth(from.accessToken, { type: 'bearer' })
      .set('Idempotency-Key', key)
      .send({ toAccountNumber: to.account.accountNumber, amount });
  }
  function auth(token: string) {
    return { Authorization: `Bearer ${token}` };
  }
  async function otp(id: string) {
    return JSON.parse(
      await readFile(join(process.env.OTP_OUTBOX_DIR!, `${id}.json`), 'utf8'),
    ).code as string;
  }

  it('checks health and propagates a request ID', async () => {
    const res = await client
      .get('/health')
      .set('X-Request-Id', 'banking-test-trace')
      .expect(200);
    expect(res.body.database).toBe('up');
    expect(res.headers['x-request-id']).toBe('banking-test-trace');
    jest
      .spyOn(db, 'transaction')
      .mockRejectedValueOnce(new Error('connection lost'));
    await client.get('/health').expect(503);
  });

  it.each(['pessimistic', 'optimistic'])(
    '%s: only ten of twenty concurrent 100,000 withdrawals succeed',
    async (mode) => {
      app.get(ConfigService).set('BANKING_LOCK_MODE', mode);
      const sender = await user();
      const responses = await Promise.all(
        Array.from({ length: 20 }, () =>
          client
            .post('/transactions/withdraw')
            .set(auth(sender.accessToken))
            .set('Idempotency-Key', randomUUID())
            .send({ amount: '100000.00' }),
        ),
      );
      expect(responses.filter((res) => res.status === 201)).toHaveLength(10);
      expect(responses.filter((res) => res.status === 400)).toHaveLength(10);
      expect(
        (
          await db
            .getRepository(Account)
            .findOneByOrFail({ id: sender.account.id })
        ).balance,
      ).toBe('0.00');
      expect(
        await db.getRepository(Transaction).countBy({ status: Status.FAILED }),
      ).toBe(10);
      expect(
        await app.get(LedgerService).getAccountLedgerBalance(sender.account.id),
      ).toBe('0.00');
    },
  );

  it('serializes five simultaneous replays and rejects altered payloads', async () => {
    const sender = await user();
    const receiver = await user();
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => transfer(sender, receiver, '100', key)),
    );
    results.forEach((result) => {
      expect(result.status).toBe(201);
      expect(result.body).toEqual(results[0].body);
    });
    expect(
      await db.getRepository(Transaction).countBy({ idempotencyKey: key }),
    ).toBe(1);
    expect(
      await db
        .getRepository(LedgerEntry)
        .countBy({ transactionId: results[0].body.id }),
    ).toBe(2);
    await transfer(sender, receiver, '101', key).expect(409);
    await transfer(receiver, sender, '100', key).expect(409);
  });

  it('transfers in opposite directions without deadlock or money loss', async () => {
    const a = await user();
    const b = await user();
    for (let i = 0; i < 8; i++)
      await Promise.all([
        transfer(a, b).expect(201),
        transfer(b, a).expect(201),
      ]);
    expect(
      (await db.getRepository(Account).findOneByOrFail({ id: a.account.id }))
        .balance,
    ).toBe('1000000.00');
    expect(
      (await db.getRepository(Account).findOneByOrFail({ id: b.account.id }))
        .balance,
    ).toBe('1000000.00');
  });

  it('rolls back balances and the debit entry when the credit insert fails', async () => {
    const a = await user();
    const b = await user();
    const ledger = app.get(LedgerService);
    const real = ledger.createEntry.bind(ledger);
    jest
      .spyOn(ledger, 'createEntry')
      .mockImplementation(async (params, manager) => {
        if (params.type === LedgerEntryType.CREDIT)
          throw new Error('Injected failure after debit');
        return real(params, manager);
      });
    const key = randomUUID();
    await transfer(a, b, '100', key).expect(500);
    expect(
      await db.getRepository(Transaction).countBy({ idempotencyKey: key }),
    ).toBe(0);
    expect(await db.getRepository(LedgerEntry).count()).toBe(2); // only opening balances
    expect(
      (await db.getRepository(Account).findOneByOrFail({ id: a.account.id }))
        .balance,
    ).toBe('1000000.00');
    expect(
      (await db.getRepository(Account).findOneByOrFail({ id: b.account.id }))
        .balance,
    ).toBe('1000000.00');
  });

  it('blocks ledger changes through both repository and SQL', async () => {
    await user();
    const entry = await db.getRepository(LedgerEntry).findOneByOrFail({});
    await expect(
      db.getRepository(LedgerEntry).update(entry.id, { amount: '1.00' }),
    ).rejects.toThrow('immutable');
    await expect(
      db.query('DELETE FROM ledger_entries WHERE id = $1', [entry.id]),
    ).rejects.toThrow('immutable');
    await expect(
      db.query('UPDATE ledger_entries SET amount = 1 WHERE id = $1', [
        entry.id,
      ]),
    ).rejects.toThrow('immutable');
  });

  it('restricts account reads, deposits, refunds and audit logs by role', async () => {
    const a = await user();
    const b = await user();
    const teller = await user(UserRole.TELLER);
    const admin = await user(UserRole.ADMIN);
    await client
      .get(`/accounts/${b.account.id}`)
      .set(auth(a.accessToken))
      .expect(403);
    await client
      .get(`/accounts/${b.account.id}`)
      .set(auth(teller.accessToken))
      .expect(200);
    await client.get('/audit-logs').set(auth(a.accessToken)).expect(403);
    await client
      .post('/transactions/deposit')
      .set(auth(a.accessToken))
      .set('Idempotency-Key', randomUUID())
      .send({ amount: '100' })
      .expect(403);
    const tx = await transfer(a, b).expect(201);
    await client
      .post(`/transactions/${tx.body.id}/reverse`)
      .set(auth(b.accessToken))
      .send({ reason: 'Unauthorized request' })
      .expect(403);
    await client
      .post(`/transactions/${tx.body.id}/reverse`)
      .set(auth(admin.accessToken))
      .send({ reason: 'Customer requested refund' })
      .expect(201);
    await client
      .post(`/transactions/${tx.body.id}/reverse`)
      .set(auth(admin.accessToken))
      .send({ reason: 'Duplicate refund request' })
      .expect(409);
    const history = await client
      .get('/transactions')
      .set(auth(a.accessToken))
      .expect(200);
    expect(
      history.body.items.find((row: any) => row.id === tx.body.id).status,
    ).toBe('reversed');
  });

  it('requires OTP at exactly ten million and only admin may approve', async () => {
    const sender = await user(UserRole.CUSTOMER, '20000000.00');
    const receiver = await user();
    const teller = await user(UserRole.TELLER);
    const admin = await user(UserRole.ADMIN);
    const pending = await transfer(sender, receiver, '10000000').expect(201);
    expect(pending.body.status).toBe('pending_otp');
    expect(pending.body).not.toHaveProperty('otpHash');
    expect(
      await db
        .getRepository(LedgerEntry)
        .countBy({ transactionId: pending.body.id }),
    ).toBe(0);
    await client
      .post(`/transactions/${pending.body.id}/verify-otp`)
      .set(auth(receiver.accessToken))
      .send({ code: await otp(pending.body.id) })
      .expect(403);
    const verified = await client
      .post(`/transactions/${pending.body.id}/verify-otp`)
      .set(auth(sender.accessToken))
      .send({ code: await otp(pending.body.id) })
      .expect(201);
    expect(verified.body.status).toBe('pending_approval');
    await client
      .post(`/transactions/${pending.body.id}/approve`)
      .set(auth(teller.accessToken))
      .expect(403);
    const completed = await client
      .post(`/transactions/${pending.body.id}/approve`)
      .set(auth(admin.accessToken))
      .expect(201);
    expect(completed.body.status).toBe('completed');
    await client
      .post(`/transactions/${pending.body.id}/approve`)
      .set(auth(admin.accessToken))
      .expect(409);
    expect(
      await db
        .getRepository(LedgerEntry)
        .countBy({ transactionId: pending.body.id }),
    ).toBe(2);
  });

  it('persists five wrong OTP attempts and permanently fails the transaction', async () => {
    const sender = await user(UserRole.CUSTOMER, '20000000.00');
    const receiver = await user();
    const pending = await transfer(sender, receiver, '10000000').expect(201);
    const actual = await otp(pending.body.id);
    const wrong = actual === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++)
      await client
        .post(`/transactions/${pending.body.id}/verify-otp`)
        .set(auth(sender.accessToken))
        .send({ code: wrong })
        .expect(400);
    await client
      .post(`/transactions/${pending.body.id}/verify-otp`)
      .set(auth(sender.accessToken))
      .send({ code: actual })
      .expect(409);
    expect(
      (
        await db
          .getRepository(Transaction)
          .findOneByOrFail({ id: pending.body.id })
      ).status,
    ).toBe('failed');
  });

  it('rejects frozen accounts, held funds and mismatched currencies with a FAILED record', async () => {
    const sender = await user();
    const receiver = await user();
    await db
      .getRepository(Account)
      .update(receiver.account.id, { status: 'frozen' as any });
    await transfer(sender, receiver).expect(400);
    await db.getRepository(Account).update(receiver.account.id, {
      status: 'active' as any,
      currency: 'USD',
    });
    await transfer(sender, receiver).expect(400);
    await db
      .getRepository(Account)
      .update(receiver.account.id, { currency: 'VND' });
    await db
      .getRepository(Account)
      .update(sender.account.id, { holdAmount: '1000000.00' });
    await transfer(sender, receiver).expect(400);
    expect(
      await db.getRepository(Transaction).countBy({ status: Status.FAILED }),
    ).toBe(3);
  });

  it('enforces daily limits including pending reservations', async () => {
    const sender = await user(UserRole.CUSTOMER, '100000000.00');
    const receiver = await user();
    await transfer(sender, receiver, '20000000').expect(201);
    await transfer(sender, receiver, '20000000').expect(201);
    await transfer(sender, receiver, '10000000').expect(201);
    const denied = await transfer(sender, receiver, '1').expect(400);
    expect(denied.body.message).toMatch('trong ngày');
    await transfer(sender, receiver, '20000001').expect(400);
  });

  it('reconciles balances and flags the sixth transaction without blocking it', async () => {
    const sender = await user();
    const receiver = await user();
    const admin = await user(UserRole.ADMIN);
    const clean = await client
      .post('/admin/monitoring/reconcile')
      .set(auth(admin.accessToken))
      .expect(201);
    expect(clean.body.status).toBe('ok');
    for (let i = 0; i < 6; i++) await transfer(sender, receiver).expect(201);
    const flagged = await client
      .get('/admin/monitoring/flagged')
      .set(auth(admin.accessToken))
      .expect(200);
    expect(flagged.body).toHaveLength(1);
    await client
      .post(`/admin/monitoring/flagged/${flagged.body[0].id}/review`)
      .set(auth(admin.accessToken))
      .send({ decision: 'approved' })
      .expect(201);
    await db
      .getRepository(Account)
      .update(sender.account.id, { balance: '999999.00' });
    const report = await client
      .post('/admin/monitoring/reconcile')
      .set(auth(admin.accessToken))
      .expect(201);
    expect(report.body.mismatches[0].accountId).toBe(sender.account.id);
  });

  it('records account status changes automatically with actor, before/after and trace', async () => {
    const sender = await user();
    const admin = await user(UserRole.ADMIN);
    await client
      .patch(`/accounts/${sender.account.id}`)
      .set(auth(admin.accessToken))
      .set('X-Request-Id', 'freeze-audit')
      .send({ status: 'frozen' })
      .expect(200);
    const rows = await db.query(
      "SELECT * FROM audit_logs WHERE request_id = 'freeze-audit' AND action = 'entity.updated'",
    );
    expect(rows[0].actor_id).toBe(admin.id);
    expect(rows[0].before_data.status).toBe('active');
    expect(rows[0].after_data.status).toBe('frozen');
    await client
      .delete(`/admin/accounts/${sender.account.id}`)
      .set(auth(admin.accessToken))
      .expect(200);
    expect(
      await db.getRepository(Account).findOneBy({ id: sender.account.id }),
    ).toBeNull();
    expect(
      (await db
        .getRepository(Account)
        .findOne({ where: { id: sender.account.id }, withDeleted: true }))!
        .deletedAt,
    ).toBeTruthy();
  });

  it('rotates refresh tokens and logout invalidates both token types', async () => {
    const sender = await user();
    const refreshed = await client
      .post('/auth/refresh')
      .send({ refreshToken: sender.refreshToken })
      .expect(200);
    expect(refreshed.body.refreshToken).not.toBe(sender.refreshToken);
    await client
      .post('/auth/logout')
      .set(auth(refreshed.body.accessToken))
      .expect(200);
    await client
      .get('/accounts/me')
      .set(auth(refreshed.body.accessToken))
      .expect(401);
    await client
      .post('/auth/refresh')
      .send({ refreshToken: refreshed.body.refreshToken })
      .expect(401);
  });

  it('revokes all sessions on password changes', async () => {
    const sender = await user();
    const second = await client
      .post('/auth/login')
      .send({ email: sender.email, password })
      .expect(200);
    await client
      .post('/auth/change-password')
      .set(auth(sender.accessToken))
      .send({ currentPassword: password, newPassword: 'Changed@12345' })
      .expect(200);
    await client
      .get('/accounts/me')
      .set(auth(second.body.accessToken))
      .expect(401);
    await client
      .post('/auth/refresh')
      .send({ refreshToken: second.body.refreshToken })
      .expect(401);
    await client
      .post('/auth/login')
      .send({ email: sender.email, password: 'Changed@12345' })
      .expect(200);
  });

  it('locks login after five bad passwords and rate limits by IP', async () => {
    const sender = await user();
    for (let i = 0; i < 5; i++)
      await client
        .post('/auth/login')
        .send({ email: sender.email, password: 'wrong' })
        .expect(401);
    const locked = await client
      .post('/auth/login')
      .send({ email: sender.email, password })
      .expect(401);
    expect(locked.body.message).toMatch('tạm khóa');
    const spam = await Promise.all(
      Array.from({ length: 8 }, () =>
        client
          .post('/auth/login')
          .send({ email: 'absent@bank.test', password: 'wrong' }),
      ),
    );
    expect(spam.some((row) => row.status === 429)).toBe(true);
  });

  it('resets the failed-login counter outside its one-minute window', async () => {
    const owner = await user();
    await db.getRepository(User).update(owner.id, {
      failedLoginCount: 4,
      failedLoginWindowStartedAt: new Date(Date.now() - 70_000),
      lastFailedLoginAt: new Date(),
    });
    await client
      .post('/auth/login')
      .send({ email: owner.email, password: 'wrong' })
      .expect(401);
    const saved = await db
      .getRepository(User)
      .findOneByOrFail({ id: owner.id });
    expect(saved.failedLoginCount).toBe(1);
    expect(saved.lockedUntil).toBeNull();
  });

  it('allows tellers to act for customers while blocking customer impersonation', async () => {
    const owner = await user();
    const receiver = await user();
    const teller = await user(UserRole.TELLER);
    const payload = {
      fromAccountNumber: owner.account.accountNumber,
      toAccountNumber: receiver.account.accountNumber,
      amount: '100',
    };
    await client
      .post('/transactions/transfer')
      .set(auth(receiver.accessToken))
      .set('Idempotency-Key', randomUUID())
      .send(payload)
      .expect(403);
    await client
      .post('/transactions/transfer')
      .set(auth(teller.accessToken))
      .set('Idempotency-Key', randomUUID())
      .send(payload)
      .expect(201);
    expect(
      (
        await db
          .getRepository(Account)
          .findOneByOrFail({ id: owner.account.id })
      ).balance,
    ).toBe('999900.00');
  });

  it('keeps profile versions in both customer and linked account history', async () => {
    const owner = await user();
    const oldEmail = owner.email;
    const changed = await client
      .patch('/users/me')
      .set(auth(owner.accessToken))
      .send({ email: 'changed@bank.test', phone: '0901234567' })
      .expect(200);
    expect(changed.body.phone).toBe('0901234567');
    const rows = await db.query(
      "SELECT before_data, after_data FROM account_history WHERE account_id = $1 AND action = 'owner_profile_change'",
      [owner.account.id],
    );
    expect(rows[0].before_data.email).toBe(oldEmail);
    expect(rows[0].after_data.phone).toBe('0901234567');
    const history = await client
      .get('/users/me/history')
      .set(auth(owner.accessToken))
      .expect(200);
    expect(history.body.items[0].beforeData.email).toBe(oldEmail);
  });

  it('revokes the rotated session when a refresh token is replayed', async () => {
    const owner = await user();
    const next = await client
      .post('/auth/refresh')
      .send({ refreshToken: owner.refreshToken })
      .expect(200);
    await client
      .post('/auth/refresh')
      .send({ refreshToken: owner.refreshToken })
      .expect(401);
    await client
      .get('/accounts/me')
      .set(auth(next.body.accessToken))
      .expect(401);
    await client
      .post('/auth/refresh')
      .send({ refreshToken: next.body.refreshToken })
      .expect(401);
  });

  it('expires OTP without changing balances', async () => {
    const owner = await user(UserRole.CUSTOMER, '20000000.00');
    const receiver = await user();
    const tx = await transfer(owner, receiver, '10000000').expect(201);
    await db
      .getRepository(Transaction)
      .update(tx.body.id, { otpExpiresAt: new Date(0) });
    await client
      .post(`/transactions/${tx.body.id}/verify-otp`)
      .set(auth(owner.accessToken))
      .send({ code: await otp(tx.body.id) })
      .expect(400);
    expect(
      (await db.getRepository(Transaction).findOneByOrFail({ id: tx.body.id }))
        .status,
    ).toBe(Status.FAILED);
    expect(
      (
        await db
          .getRepository(Account)
          .findOneByOrFail({ id: owner.account.id })
      ).balance,
    ).toBe('20000000.00');
  });

  it('counts approval after midnight against the day on which money moves', async () => {
    const owner = await user(UserRole.CUSTOMER, '100000000.00');
    const receiver = await user();
    const admin = await user(UserRole.ADMIN);
    for (let i = 0; i < 2; i++) {
      const tx = await db.getRepository(Transaction).save({
        fromAccountId: owner.account.id,
        toAccountId: receiver.account.id,
        amount: '20000000.00',
        status: Status.PENDING_APPROVAL,
        idempotencyKey: randomUUID(),
        createdAt: new Date(Date.now() - 86_400_000),
      });
      const approved = await client
        .post(`/transactions/${tx.id}/approve`)
        .set(auth(admin.accessToken))
        .expect(201);
      expect(approved.body.status).toBe(Status.COMPLETED);
    }
    await transfer(owner, receiver, '10000000').expect(201);
    const denied = await transfer(owner, receiver, '0.01').expect(400);
    expect(denied.body.message).toMatch('trong ngày');
  });

  it('recovers stale PROCESSING rows atomically without posting money', async () => {
    const sender = await user();
    const tx = await db.getRepository(Transaction).save({
      fromAccountId: sender.account.id,
      amount: '1.00',
      idempotencyKey: randomUUID(),
      status: Status.PROCESSING,
      updatedAt: new Date(Date.now() - 600_000),
    });
    await app.get(MonitoringService).recoverStale();
    expect(
      (await db.getRepository(Transaction).findOneByOrFail({ id: tx.id }))
        .status,
    ).toBe(Status.FAILED);
    expect(
      await db.getRepository(LedgerEntry).countBy({ transactionId: tx.id }),
    ).toBe(0);
  });
});
