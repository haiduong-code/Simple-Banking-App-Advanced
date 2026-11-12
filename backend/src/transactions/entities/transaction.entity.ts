import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Account } from '../../accounts/entities/account.entity';
import { LedgerEntry } from '../../ledger/entities/ledger-entry.entity';

/** Loại giao dịch. */
export enum TransactionType {
  TRANSFER = 'transfer',
  DEPOSIT = 'deposit',
  WITHDRAWAL = 'withdrawal',
  REVERSAL = 'reversal',
  OPENING_BALANCE = 'opening_balance',
}

/** Trạng thái giao dịch. */
export enum TransactionStatus {
  PENDING = 'pending',
  INITIATED = 'initiated',
  PENDING_OTP = 'pending_otp',
  PENDING_APPROVAL = 'pending_approval',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  REVERSED = 'reversed',
}

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Tài khoản nguồn (ghi nợ). Có thể null với một số loại như deposit.
  @ManyToOne(() => Account, (account) => account.outgoingTransactions, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'from_account_id' })
  fromAccount: Account | null;

  @Index()
  @Column({ name: 'from_account_id', type: 'uuid', nullable: true })
  fromAccountId: string | null;

  // Tài khoản đích (ghi có).
  @ManyToOne(() => Account, (account) => account.incomingTransactions, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'to_account_id' })
  toAccount: Account | null;

  @Index()
  @Column({ name: 'to_account_id', type: 'uuid', nullable: true })
  toAccountId: string | null;

  // Giữ numeric dưới dạng string ở tầng app để không mất độ chính xác của tiền.
  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
  })
  amount: string;

  // Một key chỉ tạo tối đa một giao dịch, chống double-submit từ client.
  @Index({ unique: true })
  @Column({ name: 'idempotency_key', type: 'uuid', unique: true })
  idempotencyKey: string;

  @Column({
    type: 'enum',
    enum: TransactionType,
    default: TransactionType.TRANSFER,
  })
  type: TransactionType;

  @Column({
    type: 'enum',
    enum: TransactionStatus,
    default: TransactionStatus.PENDING,
  })
  status: TransactionStatus;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ name: 'approved_by_id', type: 'uuid', nullable: true })
  approvedById: string | null;

  @Column({ name: 'otp_hash', type: 'varchar', nullable: true, select: false })
  otpHash: string | null;

  @Column({ name: 'otp_expires_at', type: 'timestamptz', nullable: true })
  otpExpiresAt: Date | null;

  @Column({ name: 'otp_attempts', default: 0 })
  otpAttempts: number;

  @Column({
    name: 'failure_reason',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  failureReason: string | null;

  @Column({ name: 'review_required', default: false })
  reviewRequired: boolean;

  @Column({
    name: 'review_reasons',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  reviewReasons: string[];

  @Column({ name: 'review_decision', type: 'varchar', nullable: true })
  reviewDecision: 'approved' | 'rejected' | null;

  @Column({ name: 'reviewed_by_id', type: 'uuid', nullable: true })
  reviewedById: string | null;

  @Column({
    name: 'updated_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'reversed_at', type: 'timestamptz', nullable: true })
  reversedAt: Date | null;

  // Giao dịch gốc nếu bản ghi này là giao dịch hoàn tiền/reversal.
  @ManyToOne(
    () => Transaction,
    (transaction) => transaction.reversalTransactions,
    {
      nullable: true,
      onDelete: 'RESTRICT',
    },
  )
  @JoinColumn({ name: 'original_transaction_id' })
  originalTransaction: Transaction | null;

  @Index({ unique: true, where: 'original_transaction_id IS NOT NULL' })
  @Column({ name: 'original_transaction_id', type: 'uuid', nullable: true })
  originalTransactionId: string | null;

  // Các giao dịch hoàn tiền trỏ về giao dịch gốc này.
  @OneToMany(
    () => Transaction,
    (transaction) => transaction.originalTransaction,
  )
  reversalTransactions: Transaction[];

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  // Các bút toán sổ cái được sinh từ giao dịch này.
  @OneToMany(() => LedgerEntry, (entry) => entry.transaction)
  ledgerEntries: LedgerEntry[];
}
