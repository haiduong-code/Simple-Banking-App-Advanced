import { ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Transaction, TransactionStatus } from './entities/transaction.entity';
import { TransactionStateService } from './transaction-state.service';

describe('TransactionStateService', () => {
  let service: TransactionStateService;
  let save: jest.Mock;
  let manager: EntityManager;

  beforeEach(() => {
    service = new TransactionStateService();
    save = jest.fn(async (transaction: Transaction) => transaction);
    manager = {
      getRepository: jest.fn().mockReturnValue({ save }),
    } as unknown as EntityManager;
  });

  it('allows pending -> completed and sets completedAt', async () => {
    const transaction = {
      status: TransactionStatus.PENDING,
      completedAt: null,
      reversedAt: null,
    } as Transaction;

    const result = await service.transition(
      transaction,
      TransactionStatus.COMPLETED,
      manager,
    );

    expect(result.status).toBe(TransactionStatus.COMPLETED);
    expect(result.completedAt).toBeInstanceOf(Date);
    expect(result.reversedAt).toBeNull();
    expect(save).toHaveBeenCalledWith(transaction);
  });

  it('allows completed -> reversed and sets reversedAt', async () => {
    const transaction = {
      status: TransactionStatus.COMPLETED,
      completedAt: new Date('2026-07-10T00:00:00.000Z'),
      reversedAt: null,
    } as Transaction;

    const result = await service.transition(
      transaction,
      TransactionStatus.REVERSED,
      manager,
    );

    expect(result.status).toBe(TransactionStatus.REVERSED);
    expect(result.completedAt).toEqual(new Date('2026-07-10T00:00:00.000Z'));
    expect(result.reversedAt).toBeInstanceOf(Date);
    expect(save).toHaveBeenCalledWith(transaction);
  });

  it.each([
    [TransactionStatus.FAILED, TransactionStatus.COMPLETED],
    [TransactionStatus.REVERSED, TransactionStatus.COMPLETED],
    [TransactionStatus.COMPLETED, TransactionStatus.COMPLETED],
  ])('rejects %s -> %s', async (from, to) => {
    await expect(
      service.transition({ status: from } as Transaction, to, manager),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(save).not.toHaveBeenCalled();
  });
});
