import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { logEvent } from '../common/request-context';
import {
  Transaction,
  TransactionStatus as Status,
} from '../transactions/entities/transaction.entity';
import { TransactionStateService } from '../transactions/transaction-state.service';
import { LedgerEntry } from '../ledger/entities/ledger-entry.entity';
import { ReconciliationReport } from './entities/reconciliation-report.entity';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class MonitoringService {
  constructor(
    private readonly db: DataSource,
    private readonly state: TransactionStateService,
    private readonly audit: AuditService,
  ) {}

  async health() {
    const start = performance.now();
    try {
      await this.db.transaction(async (manager) => {
        await manager.query("SET LOCAL statement_timeout = '2s'");
        await manager.query('SELECT 1');
      });
      return {
        status: 'ok',
        database: 'up',
        responseTimeMs: Math.round(performance.now() - start),
      };
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        database: 'down',
        responseTimeMs: Math.round(performance.now() - start),
      });
    }
  }

  @Cron('0 59 23 * * *', {
    timeZone: 'Asia/Ho_Chi_Minh',
    waitForCompletion: true,
  })
  async reconcile() {
    // One SQL statement gives balances and entries the same MVCC snapshot during live traffic.
    return this.db.transaction('REPEATABLE READ', async (manager) => {
      const rows: Array<{
        accountId: string;
        cachedBalance: string;
        ledgerBalance: string;
      }> = await manager.query(`
        SELECT a.id AS "accountId", a.balance::text AS "cachedBalance",
          COALESCE(SUM(CASE WHEN l.type = 'credit' THEN l.amount ELSE -l.amount END), 0)::text AS "ledgerBalance"
        FROM accounts a LEFT JOIN ledger_entries l ON l.account_id = a.id GROUP BY a.id`);
      const decimalMinor = (value: string) => {
        const [whole, fraction = ''] = value.split('.');
        return (
          BigInt(whole) * 100n +
          BigInt(fraction.padEnd(2, '0')) * (value.startsWith('-') ? -1n : 1n)
        );
      };
      const mismatches = rows.filter(
        (row) =>
          decimalMinor(row.cachedBalance) !== decimalMinor(row.ledgerBalance),
      );
      const report = await manager.getRepository(ReconciliationReport).save({
        checkedAccounts: rows.length,
        status: mismatches.length ? 'mismatch' : 'ok',
        mismatches,
      });
      if (mismatches.length)
        logEvent('error', 'reconciliation.mismatch', {
          reportId: report.id,
          mismatches,
        });
      return report;
    });
  }

  reports() {
    return this.db
      .getRepository(ReconciliationReport)
      .find({ order: { createdAt: 'DESC' }, take: 50 });
  }

  @Cron('0 * * * * *', { waitForCompletion: true })
  async recoverStale() {
    return this.db.transaction(async (manager) => {
      const txs = await manager
        .getRepository(Transaction)
        .createQueryBuilder('tx')
        .where(
          '(tx.status IN (:...states) AND tx.updatedAt < :cutoff) OR (tx.status = :otp AND tx.otpExpiresAt < :now)',
          {
            states: [Status.INITIATED, Status.PROCESSING, Status.PENDING],
            cutoff: new Date(Date.now() - 5 * 60_000),
            otp: Status.PENDING_OTP,
            now: new Date(),
          },
        )
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany();
      for (const tx of txs) {
        // The normal posting is atomic. Existing entries on a stale row imply an integrity issue;
        // never blindly credit the account a second time.
        if (
          await manager
            .getRepository(LedgerEntry)
            .exists({ where: { transactionId: tx.id } })
        ) {
          if (!tx.reviewReasons.includes('stale_with_committed_ledger')) {
            tx.reviewRequired = true;
            tx.reviewReasons.push('stale_with_committed_ledger');
            await manager.getRepository(Transaction).save(tx);
          }
          logEvent('error', 'transaction.recovery.requires_review', {
            transactionId: tx.id,
          });
          continue;
        }
        tx.failureReason =
          tx.status === Status.PENDING_OTP
            ? 'OTP hết hạn'
            : 'Giao dịch quá thời gian xử lý';
        tx.otpHash = null;
        await this.state.transition(tx, Status.FAILED, manager);
        await this.audit.logInTransaction(
          'transaction.recovered',
          {
            entity: 'Transaction',
            entityId: tx.id,
            afterData: { status: tx.status, reason: tx.failureReason },
          },
          manager,
        );
      }
      return { checked: txs.length };
    });
  }

  flagged() {
    return this.db.getRepository(Transaction).find({
      where: { reviewRequired: true },
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  async review(id: string, actorId: string, decision: 'approved' | 'rejected') {
    return this.db.transaction(async (manager) => {
      const repository = manager.getRepository(Transaction);
      const tx = await repository.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!tx) throw new NotFoundException('Không tìm thấy giao dịch');
      if (!tx.reviewRequired || tx.reviewDecision)
        throw new ConflictException(
          'Giao dịch không cần review hoặc đã được review',
        );
      tx.reviewDecision = decision;
      tx.reviewedById = actorId;
      await repository.save(tx);
      await this.audit.logInTransaction(
        'transaction.fraud.reviewed',
        {
          actorId,
          entity: 'Transaction',
          entityId: id,
          afterData: { decision },
        },
        manager,
      );
      return { id, decision };
    });
  }
}
