import { DataSource, EntityManager } from 'typeorm';
import { logEvent } from './request-context';

export class OptimisticConflict extends Error {}

export async function withTransactionRetry<T>(
  db: DataSource,
  work: (manager: EntityManager) => Promise<T>,
  maxRetries = 20,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await db.transaction('READ COMMITTED', async (manager) => {
        await manager.query("SET LOCAL lock_timeout = '5s'");
        await manager.query("SET LOCAL statement_timeout = '15s'");
        return work(manager);
      });
      if (attempt)
        logEvent('info', 'transaction.retry.success', { retries: attempt });
      return result;
    } catch (error) {
      const failure = error as {
        driverError?: { code?: string };
        code?: string;
      } | null;
      const code = failure?.driverError?.code ?? failure?.code;
      if (
        attempt >= maxRetries ||
        (!(error instanceof OptimisticConflict) &&
          !['40P01', '40001', '55P03'].includes(code))
      )
        throw error;
      logEvent('warn', 'transaction.retry', {
        attempt: attempt + 1,
        reason: code ?? 'version_conflict',
      });
      await new Promise((resolve) =>
        setTimeout(resolve, 5 * (attempt + 1) + Math.random() * 20),
      );
    }
  }
}
