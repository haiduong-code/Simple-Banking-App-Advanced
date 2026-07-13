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
  REVERSAL = 'reversal',
  OPENING_BALANCE = 'opening_balance',
}

/** Trạng thái giao dịch. */
export enum TransactionStatus {
  PENDING = 'pending',
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

  @Index()
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
