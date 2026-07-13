import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Account } from './account.entity';

export type AccountHistoryData = Record<string, unknown>;

@Entity('account_history')
export class AccountHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Account, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @Index()
  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @Index()
  @Column({ name: 'changed_by_id', type: 'uuid', nullable: true })
  changedById: string | null;

  @Index()
  @Column({ type: 'varchar', length: 80 })
  action: string;

  @Column({ name: 'before_data', type: 'jsonb' })
  beforeData: AccountHistoryData;

  @Column({ name: 'after_data', type: 'jsonb', nullable: true })
  afterData: AccountHistoryData | null;

  @Index()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
