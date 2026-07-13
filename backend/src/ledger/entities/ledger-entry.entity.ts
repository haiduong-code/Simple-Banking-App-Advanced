import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Account } from '../../accounts/entities/account.entity';
import { Transaction } from '../../transactions/entities/transaction.entity';

/** Loại bút toán trong sổ cái theo góc nhìn của tài khoản. */
export enum LedgerEntryType {
  DEBIT = 'debit',
  CREDIT = 'credit',
}

@Entity('ledger_entries')
export class LedgerEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Account, (account) => account.ledgerEntries, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @Index()
  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @ManyToOne(() => Transaction, (transaction) => transaction.ledgerEntries, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'transaction_id' })
  transaction: Transaction;

  @Index()
  @Column({ name: 'transaction_id', type: 'uuid' })
  transactionId: string;

  @Column({
    type: 'enum',
    enum: LedgerEntryType,
  })
  type: LedgerEntryType;

  // Luôn là số dương; chiều tiền được thể hiện bằng type DEBIT/CREDIT.
  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
  })
  amount: string;

  // Số dư cached của account ngay sau khi bút toán này được ghi.
  @Column({
    name: 'balance_after',
    type: 'numeric',
    precision: 18,
    scale: 2,
  })
  balanceAfter: string;

  @Index()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
