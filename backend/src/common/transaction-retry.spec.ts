import { DataSource } from 'typeorm';
import { OptimisticConflict, withTransactionRetry } from './transaction-retry';
describe('Transaction retry', () => {
  it.each([
    new OptimisticConflict(),
    { driverError: { code: '40P01' } },
    { code: '40001' },
    { code: '55P03' },
  ])('retries the whole transaction after %p', async (failure) => {
    const manager = { query: jest.fn() };
    const db = {
      transaction: jest
        .fn()
        .mockRejectedValueOnce(failure)
        .mockImplementation((_level, callback) => callback(manager)),
    };
    const work = jest.fn(async () => 'committed');
    await expect(
      withTransactionRetry(db as unknown as DataSource, work),
    ).resolves.toBe('committed');
    expect(db.transaction).toHaveBeenCalledTimes(2);
  });
  it('bounds retries and does not retry unknown failures', async () => {
    const db = {
      transaction: jest.fn().mockRejectedValue(new OptimisticConflict()),
    };
    await expect(
      withTransactionRetry(db as unknown as DataSource, jest.fn(), 1),
    ).rejects.toBeInstanceOf(OptimisticConflict);
    expect(db.transaction).toHaveBeenCalledTimes(2);
    db.transaction.mockReset().mockRejectedValue(new Error('network'));
    await expect(
      withTransactionRetry(db as unknown as DataSource, jest.fn()),
    ).rejects.toThrow('network');
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });
});
