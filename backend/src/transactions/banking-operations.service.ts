import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomInt } from 'node:crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import { Account } from '../accounts/entities/account.entity';
import { AuditService } from '../audit/audit.service';
import { AuditRequestContext } from '../audit/audit-request-context';
import { moneyToMinorUnits, normalizeMoney } from '../common/money';
import {
  OptimisticConflict,
  withTransactionRetry,
} from '../common/transaction-retry';
import { LedgerService } from '../ledger/ledger.service';
import { User, UserRole, UserStatus } from '../users/entities/user.entity';
import { TransferDto } from './dto/transfer.dto';
import { CashDto } from './dto/security.dto';
import { IdempotencyKey } from './entities/idempotency-key.entity';
import {
  Transaction,
  TransactionStatus as Status,
  TransactionType as Type,
} from './entities/transaction.entity';
import { OtpDeliveryService } from './otp-delivery.service';
import {
  OTP_THRESHOLD,
  validateMovement,
  vietnamDayBounds,
} from './transaction-policy';
import { TransactionStateService } from './transaction-state.service';

interface Outcome {
  response: Record<string, unknown>;
  code: number;
}

export function transactionResult(tx: Transaction) {
  return {
    id: tx.id,
    fromAccountNumber: tx.fromAccount?.accountNumber ?? null,
    toAccountNumber: tx.toAccount?.accountNumber ?? null,
    amount: normalizeMoney(tx.amount),
    type: tx.type,
    status: tx.status,
    originalTransactionId: tx.originalTransactionId ?? null,
    reversalTransactionId: tx.reversalTransactions?.[0]?.id ?? null,
    description: tx.description,
    createdAt: tx.createdAt,
    completedAt: tx.completedAt ?? null,
    reversedAt: tx.reversedAt ?? null,
    failureReason: tx.failureReason ?? null,
    reviewRequired: tx.reviewRequired ?? false,
    otpExpiresAt: tx.otpExpiresAt ?? null,
  };
}

@Injectable()
export class BankingOperationsService {
  constructor(
    private readonly db: DataSource,
    private readonly state: TransactionStateService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly otpDelivery: OtpDeliveryService,
  ) {}

  private get optimistic() {
    return this.config.get('BANKING_LOCK_MODE', 'pessimistic') === 'optimistic';
  }

  async start(
    actorId: string,
    dto: TransferDto | CashDto,
    key: string,
    type: Type,
    context?: AuditRequestContext,
  ) {
    const amount = normalizeMoney(dto.amount);
    if (moneyToMinorUnits(amount) <= 0n)
      throw new BadRequestException('Số tiền phải lớn hơn 0');
    const description = dto.description?.trim() || null;
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          actorId,
          type,
          amount,
          description,
          from: dto.fromAccountNumber ?? null,
          to: (dto as TransferDto).toAccountNumber ?? null,
        }),
      )
      .digest('hex');
    const outcome = await withTransactionRetry(this.db, async (manager) => {
      // Global key lock also serializes different senders using the same UUID.
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [key],
      );
      const keys = manager.getRepository(IdempotencyKey);
      const previous = await keys.findOne({ where: { key } });
      if (previous) {
        if (
          previous.actorId !== actorId ||
          previous.requestHash !== requestHash
        )
          throw new ConflictException(
            'Idempotency-Key đã được dùng cho một yêu cầu khác',
          );
        return { response: previous.response, code: previous.responseCode };
      }
      // Old transactions retain their keys permanently; never execute them twice after an upgrade.
      if (
        await manager
          .getRepository(Transaction)
          .exists({ where: { idempotencyKey: key } })
      )
        throw new ConflictException('Idempotency-Key đã tồn tại trong lịch sử');
      const actor = await manager
        .getRepository(User)
        .findOneBy({ id: actorId });
      if (!actor || actor.status !== UserStatus.ACTIVE)
        throw new ForbiddenException('Người dùng không hoạt động');
      const accounts = manager.getRepository(Account);
      const own = dto.fromAccountNumber
        ? await accounts.findOneBy({ accountNumber: dto.fromAccountNumber })
        : await accounts.findOneBy({ userId: actorId });
      if (!own) throw new NotFoundException('Không tìm thấy tài khoản nguồn');
      if (own.userId !== actorId && actor.role === UserRole.CUSTOMER)
        throw new ForbiddenException(
          'Chỉ được thao tác trên tài khoản của mình',
        );
      if (type === Type.DEPOSIT && actor.role === UserRole.CUSTOMER)
        throw new ForbiddenException(
          'Chỉ giao dịch viên hoặc admin được nạp tiền',
        );
      const target =
        type === Type.TRANSFER
          ? await accounts.findOneBy({
              accountNumber: (dto as TransferDto).toAccountNumber,
            })
          : null;
      if (type === Type.TRANSFER && !target)
        throw new NotFoundException('Tài khoản đích không tồn tại');
      if (own.id === target?.id)
        throw new BadRequestException('Không thể chuyển tiền cho chính mình');
      const locked = await this.lockAccounts(
        [own.id, target?.id].filter(Boolean),
        manager,
      );
      const source =
        type === Type.DEPOSIT ? null : locked.find((a) => a.id === own.id);
      const destination =
        type === Type.DEPOSIT
          ? locked[0]
          : (locked.find((a) => a.id === target?.id) ?? null);
      const txRepo = manager.getRepository(Transaction);
      let tx = await txRepo.save(
        txRepo.create({
          actorId,
          fromAccountId: source?.id ?? null,
          toAccountId: destination?.id ?? null,
          amount,
          description,
          type,
          status: Status.INITIATED,
          idempotencyKey: key,
        }),
      );
      tx.fromAccount = source;
      tx.toAccount = destination;
      let code = 201;
      try {
        await this.validate(tx, source, destination, manager);
        if (moneyToMinorUnits(amount) >= OTP_THRESHOLD) {
          const otp = randomInt(0, 1_000_000).toString().padStart(6, '0');
          tx.otpHash = this.otpHash(tx.id, otp);
          tx.otpExpiresAt = new Date(Date.now() + 300_000);
          tx = await this.state.transition(tx, Status.PENDING_OTP, manager);
          // Bump the account version so concurrent optimistic daily-limit reservations conflict.
          if (this.optimistic)
            await this.ledger.saveBalances(
              [source ?? destination],
              manager,
              true,
            );
          await this.otpDelivery.deliver(
            tx.id,
            (source ?? destination).userId,
            otp,
            tx.otpExpiresAt,
          );
        } else {
          tx = await this.execute(tx, source, destination, manager);
        }
      } catch (error) {
        if (!(error instanceof HttpException)) throw error;
        tx.failureReason = error.message.slice(0, 255);
        tx = await this.state.transition(tx, Status.FAILED, manager);
        code = error.getStatus();
      }
      await this.audit.logInTransaction(
        'transaction.created',
        {
          actorId,
          entity: 'Transaction',
          entityId: tx.id,
          ...context,
          afterData: {
            type,
            status: tx.status,
            amount,
            failureReason: tx.failureReason,
          },
        },
        manager,
      );
      const response =
        code >= 400
          ? {
              statusCode: code,
              message: tx.failureReason,
              transactionId: tx.id,
            }
          : transactionResult(tx);
      // Store exactly the wire representation, including dates, for identical replay responses.
      const serialized = JSON.parse(JSON.stringify(response)) as Record<
        string,
        unknown
      >;
      await keys.save({
        key,
        actorId,
        requestHash,
        response: serialized,
        responseCode: code,
        status: tx.status,
        expiredAt: new Date(Date.now() + 86_400_000),
      });
      return { response: serialized, code };
    });
    return this.unwrap(outcome);
  }

  async verifyOtp(actorId: string, id: string, code: string) {
    const outcome = await withTransactionRetry(this.db, async (manager) => {
      const tx = await this.getLocked(id, manager, true);
      const ownerAccountId = tx.fromAccountId ?? tx.toAccountId;
      const owner = ownerAccountId
        ? await manager.getRepository(Account).findOneBy({ id: ownerAccountId })
        : null;
      if (!owner || owner.userId !== actorId)
        throw new ForbiddenException('Chỉ chủ tài khoản được xác nhận OTP');
      if (tx.status !== Status.PENDING_OTP)
        throw new ConflictException('Giao dịch không chờ OTP');
      if (
        !tx.otpExpiresAt ||
        tx.otpExpiresAt.getTime() <= Date.now() ||
        tx.otpAttempts >= 5
      ) {
        tx.failureReason = 'OTP hết hạn hoặc vượt số lần thử';
        tx.otpHash = null;
        await this.state.transition(tx, Status.FAILED, manager);
        return { response: { message: tx.failureReason }, code: 400 };
      }
      if (tx.otpHash !== this.otpHash(tx.id, code)) {
        tx.otpAttempts++;
        if (tx.otpAttempts >= 5) {
          tx.otpHash = null;
          tx.failureReason = 'Nhập sai OTP quá 5 lần';
          await this.state.transition(tx, Status.FAILED, manager);
        } else await manager.getRepository(Transaction).save(tx);
        return {
          response: {
            message: 'OTP không đúng',
            attemptsRemaining: 5 - tx.otpAttempts,
          },
          code: 400,
        };
      }
      tx.otpHash = null;
      await this.state.transition(tx, Status.PENDING_APPROVAL, manager);
      await this.audit.logInTransaction(
        'transaction.otp.verified',
        { actorId, entity: 'Transaction', entityId: id },
        manager,
      );
      return { response: transactionResult(tx), code: 200 };
    });
    return this.unwrap(outcome);
  }

  async approve(actorId: string, id: string, approve: boolean) {
    const outcome = await withTransactionRetry(this.db, async (manager) => {
      const actor = await manager
        .getRepository(User)
        .findOneBy({ id: actorId });
      if (actor?.role !== UserRole.ADMIN || actor.status !== UserStatus.ACTIVE)
        throw new ForbiddenException('Chỉ admin được duyệt giao dịch lớn');
      const tx = await this.getLocked(id, manager);
      if (tx.status !== Status.PENDING_APPROVAL)
        throw new ConflictException('Giao dịch không chờ duyệt');
      if (!approve) {
        tx.failureReason = 'Admin từ chối giao dịch';
        await this.state.transition(tx, Status.FAILED, manager);
      } else {
        const accounts = await this.lockAccounts(
          [tx.fromAccountId, tx.toAccountId].filter(Boolean),
          manager,
        );
        const source = accounts.find((a) => a.id === tx.fromAccountId) ?? null;
        const destination =
          accounts.find((a) => a.id === tx.toAccountId) ?? null;
        tx.approvedById = actorId;
        try {
          await this.validate(tx, source, destination, manager);
          await this.execute(tx, source, destination, manager);
        } catch (error) {
          if (!(error instanceof HttpException)) throw error;
          tx.failureReason = error.message.slice(0, 255);
          await this.state.transition(tx, Status.FAILED, manager);
        }
      }
      await this.audit.logInTransaction(
        'transaction.approval',
        {
          actorId,
          entity: 'Transaction',
          entityId: id,
          afterData: { approved: approve, status: tx.status },
        },
        manager,
      );
      return { response: transactionResult(tx), code: 200 };
    });
    return this.unwrap(outcome);
  }

  async getForUser(actorId: string, id: string) {
    const tx = await this.db.getRepository(Transaction).findOne({
      where: { id },
      relations: {
        fromAccount: true,
        toAccount: true,
        reversalTransactions: true,
      },
    });
    if (!tx) throw new NotFoundException('Không tìm thấy giao dịch');
    const user = await this.db
      .getRepository(User)
      .findOneByOrFail({ id: actorId });
    if (
      user.role === UserRole.CUSTOMER &&
      tx.fromAccount?.userId !== actorId &&
      tx.toAccount?.userId !== actorId
    )
      throw new ForbiddenException('Không có quyền xem giao dịch');
    return transactionResult(tx);
  }

  private async getLocked(id: string, manager: EntityManager, otp = false) {
    const qb = manager
      .getRepository(Transaction)
      .createQueryBuilder('tx')
      .where('tx.id = :id', { id })
      .setLock('pessimistic_write');
    if (otp) qb.addSelect('tx.otpHash');
    const tx = await qb.getOne();
    if (!tx) throw new NotFoundException('Không tìm thấy giao dịch');
    return tx;
  }

  private async lockAccounts(ids: string[], manager: EntityManager) {
    const accounts = await manager.getRepository(Account).find({
      where: { id: In(ids) },
      order: { id: 'ASC' },
      ...(!this.optimistic
        ? { lock: { mode: 'pessimistic_write' as const } }
        : {}),
    });
    if (accounts.length !== new Set(ids).size)
      throw new BadRequestException('Tài khoản đã đóng hoặc bị xóa');
    return accounts;
  }

  private async validate(
    tx: Transaction,
    source: Account | null,
    destination: Account | null,
    manager: EntityManager,
  ) {
    for (const account of [source, destination]) {
      if (
        account &&
        !(await manager
          .getRepository(User)
          .exists({ where: { id: account.userId, status: UserStatus.ACTIVE } }))
      )
        throw new BadRequestException('Chủ tài khoản đang bị khóa');
    }
    if ((tx.fromAccountId && !source) || (tx.toAccountId && !destination))
      throw new BadRequestException('Tài khoản không còn hoạt động');
    const { start, end } = vietnamDayBounds();
    const spent = source
      ? await manager
          .getRepository(Transaction)
          .createQueryBuilder('tx')
          .select('COALESCE(SUM(tx.amount), 0)', 'amount')
          .where('tx.fromAccountId = :id AND tx.id <> :txId', {
            id: source.id,
            txId: tx.id,
          })
          .andWhere('tx.type IN (:...types)', {
            types: [Type.TRANSFER, Type.WITHDRAWAL],
          })
          .andWhere(
            '((tx.status IN (:...settled) AND tx.completedAt >= :start AND tx.completedAt < :end) OR (tx.status IN (:...reserved) AND tx.createdAt >= :start AND tx.createdAt < :end))',
            {
              settled: [Status.COMPLETED, Status.REVERSED],
              reserved: [
                Status.PENDING_OTP,
                Status.PENDING_APPROVAL,
                Status.PROCESSING,
              ],
              start,
              end,
            },
          )
          .getRawOne<{ amount: string }>()
      : null;
    validateMovement(
      source,
      destination,
      moneyToMinorUnits(tx.amount),
      moneyToMinorUnits(spent?.amount ?? '0'),
    );
  }

  private async execute(
    tx: Transaction,
    source: Account | null,
    destination: Account | null,
    manager: EntityManager,
  ) {
    await this.state.transition(tx, Status.PROCESSING, manager);
    await manager.query('SAVEPOINT movement');
    try {
      if (tx.type === Type.TRANSFER)
        await this.ledger.recordTransfer(
          {
            transaction: tx,
            sourceAccount: source,
            destinationAccount: destination,
            amount: tx.amount,
            sourceBalanceBefore: source.balance,
            destinationBalanceBefore: destination.balance,
            optimistic: this.optimistic,
          },
          manager,
        );
      else
        await this.ledger.recordCash(
          source ?? destination,
          tx,
          tx.type === Type.DEPOSIT,
          manager,
          this.optimistic,
        );
      tx.fromAccount = source;
      tx.toAccount = destination;
      await this.flagFraud(tx, manager);
      await this.state.transition(tx, Status.COMPLETED, manager);
      await manager.query('RELEASE SAVEPOINT movement');
      return tx;
    } catch (error) {
      await manager.query('ROLLBACK TO SAVEPOINT movement');
      if (error instanceof OptimisticConflict) throw error;
      throw error;
    }
  }

  private async flagFraud(tx: Transaction, manager: EntityManager) {
    if (!tx.fromAccountId) return;
    const rows = await manager
      .getRepository(Transaction)
      .createQueryBuilder('tx')
      .select('COUNT(*) FILTER (WHERE tx.completedAt >= :minute)', 'recent')
      .addSelect(
        'COALESCE(CAST(:currentAmount AS numeric) > 5 * AVG(tx.amount), false)',
        'unusual',
      )
      .where(
        'tx.fromAccountId = :id AND tx.status IN (:...states) AND tx.type IN (:...types)',
        {
          id: tx.fromAccountId,
          states: [Status.COMPLETED, Status.REVERSED],
          types: [Type.TRANSFER, Type.WITHDRAWAL],
          currentAmount: tx.amount,
        },
      )
      .andWhere('tx.completedAt >= :month AND tx.id <> :txId', {
        month: new Date(Date.now() - 30 * 86_400_000),
        minute: new Date(Date.now() - 60_000),
        txId: tx.id,
      })
      .getRawOne<{ recent: string; unusual: boolean }>();
    const reasons: string[] = [];
    if (Number(rows.recent) >= 5)
      reasons.push('more_than_5_transactions_per_minute');
    if (rows.unusual) reasons.push('amount_above_5x_30_day_average');
    tx.reviewRequired = reasons.length > 0;
    tx.reviewReasons = reasons;
  }

  private otpHash(id: string, code: string) {
    return createHmac('sha256', this.config.getOrThrow<string>('JWT_SECRET'))
      .update(`${id}:${code}`)
      .digest('hex');
  }
  private unwrap(outcome: Outcome): ReturnType<typeof transactionResult> {
    if (outcome.code >= 400)
      throw new HttpException(outcome.response, outcome.code);
    return outcome.response as ReturnType<typeof transactionResult>;
  }
}
