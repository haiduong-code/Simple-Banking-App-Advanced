import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
@Entity('reconciliation_reports')
export class ReconciliationReport {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'checked_accounts' }) checkedAccounts: number;
  @Column({ type: 'varchar' }) status: string;
  @Column({ type: 'jsonb' }) mismatches: Array<{
    accountId: string;
    cachedBalance: string;
    ledgerBalance: string;
  }>;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
