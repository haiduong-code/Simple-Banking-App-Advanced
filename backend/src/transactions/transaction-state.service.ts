import { ConflictException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Transaction, TransactionStatus } from './entities/transaction.entity';

const ALLOWED_TRANSITIONS: Record<
  TransactionStatus,
  readonly TransactionStatus[]
> = {
  [TransactionStatus.PENDING]: [
    TransactionStatus.COMPLETED,
    TransactionStatus.FAILED,
  ],
  [TransactionStatus.COMPLETED]: [TransactionStatus.REVERSED],
  [TransactionStatus.FAILED]: [],
  [TransactionStatus.REVERSED]: [],
};

@Injectable()
export class TransactionStateService {
  assertCanTransition(from: TransactionStatus, to: TransactionStatus): void {
    if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
      throw new ConflictException(
        `Cannot transition transaction from ${from} to ${to}`,
      );
    }
  }

  async transition(
    transaction: Transaction,
    to: TransactionStatus,
    manager: EntityManager,
  ): Promise<Transaction> {
    this.assertCanTransition(transaction.status, to);

    transaction.status = to;
    const now = new Date();

    if (to === TransactionStatus.COMPLETED) {
      transaction.completedAt = now;
    }

    if (to === TransactionStatus.REVERSED) {
      transaction.reversedAt = now;
    }

    return manager.getRepository(Transaction).save(transaction);
  }
}
