import {
  Account,
  AccountStatus,
  AccountTier,
} from '../accounts/entities/account.entity';
import { MAX_MONEY_MINOR_UNITS } from '../common/money';
import { validateMovement, vietnamDayBounds } from './transaction-policy';
describe('Banking movement policy (no database)', () => {
  const source = (overrides: Partial<Account> = {}) =>
    ({
      balance: '50000000.00',
      holdAmount: '0.00',
      status: AccountStatus.ACTIVE,
      tier: AccountTier.STANDARD,
      currency: 'VND',
      ...overrides,
    }) as Account;
  it.each([0n, -1n])('rejects nonpositive amount %s', (amount) =>
    expect(() => validateMovement(source(), null, amount)).toThrow('lớn hơn 0'),
  );
  it('accepts exact per-transfer and daily boundaries, rejecting one cent more', () => {
    expect(() =>
      validateMovement(source(), null, 2_000_000_000n, 3_000_000_000n),
    ).not.toThrow();
    expect(() => validateMovement(source(), null, 2_000_000_001n)).toThrow(
      'một lần',
    );
    expect(() =>
      validateMovement(source(), null, 100n, 4_999_999_901n),
    ).toThrow('trong ngày');
  });
  it.each([AccountStatus.CLOSED, AccountStatus.FROZEN])(
    'blocks %s on either side',
    (status) => {
      expect(() => validateMovement(source({ status }), source(), 1n)).toThrow(
        'ACTIVE',
      );
      expect(() => validateMovement(source(), source({ status }), 1n)).toThrow(
        'ACTIVE',
      );
    },
  );
  it('rejects deleted accounts and currency mismatches', () => {
    expect(() =>
      validateMovement(source({ deletedAt: new Date() }), null, 1n),
    ).toThrow('ACTIVE');
    expect(() =>
      validateMovement(source(), source({ currency: 'USD' }), 1n),
    ).toThrow('tiền tệ');
  });
  it('handles empty balance, held funds, exact available balance and overflow', () => {
    expect(() =>
      validateMovement(source({ balance: '0.00' }), null, 1n),
    ).toThrow('khả dụng');
    expect(() =>
      validateMovement(
        source({ balance: '100.00', holdAmount: '20.00' }),
        null,
        8000n,
      ),
    ).not.toThrow();
    expect(() =>
      validateMovement(
        source({ balance: '100.00', holdAmount: '20.00' }),
        null,
        8001n,
      ),
    ).toThrow('khả dụng');
    expect(() =>
      validateMovement(null, source({ balance: '9999999999999999.99' }), 1n),
    ).toThrow('giới hạn');
  });
  it('uses the VIP limits', () => {
    const vip = source({ tier: AccountTier.VIP, balance: '200000000.00' });
    expect(() =>
      validateMovement(vip, null, 10_000_000_000n, 10_000_000_000n),
    ).not.toThrow();
    expect(() => validateMovement(vip, null, 10_000_000_001n)).toThrow(
      'một lần',
    );
    expect(() =>
      validateMovement(null, null, MAX_MONEY_MINOR_UNITS),
    ).not.toThrow();
  });
  it('changes the day at 17:00 UTC, including month/year rollover', () => {
    expect(
      vietnamDayBounds(new Date('2026-12-31T16:59:59Z')).start.toISOString(),
    ).toBe('2026-12-30T17:00:00.000Z');
    const { start, end } = vietnamDayBounds(new Date('2026-12-31T17:00:00Z'));
    expect(start.toISOString()).toBe('2026-12-31T17:00:00.000Z');
    expect(end.toISOString()).toBe('2027-01-01T17:00:00.000Z');
  });
});
