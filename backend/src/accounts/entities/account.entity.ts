import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { LedgerEntry } from '../../ledger/entities/ledger-entry.entity';
import { Transaction } from '../../transactions/entities/transaction.entity';
import { User } from '../../users/entities/user.entity';

@Entity('accounts')
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Chủ tài khoản. Không hard delete user vì account/transaction/ledger cần giữ lịch sử.
  @ManyToOne(() => User, (user) => user.accounts, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  // Số tài khoản tự sinh, duy nhất toàn hệ thống.
  @Index({ unique: true })
  @Column({ name: 'account_number', type: 'varchar', length: 32, unique: true })
  accountNumber: string;

  // Giữ numeric dưới dạng string ở tầng app để không mất độ chính xác của tiền.
  @Column({
    type: 'numeric',
    precision: 18,
    scale: 2,
    default: '0.00',
  })
  balance: string;

  @Column({ type: 'varchar', length: 3, default: 'VND' })
  currency: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  // Giao dịch ghi nợ (tiền ra) từ tài khoản này.
  @OneToMany(() => Transaction, (tx) => tx.fromAccount)
  outgoingTransactions: Transaction[];

  // Giao dịch ghi có (tiền vào) tới tài khoản này.
  @OneToMany(() => Transaction, (tx) => tx.toAccount)
  incomingTransactions: Transaction[];

  // Các bút toán bất biến phát sinh trên tài khoản này.
  @OneToMany(() => LedgerEntry, (entry) => entry.account)
  ledgerEntries: LedgerEntry[];
}
