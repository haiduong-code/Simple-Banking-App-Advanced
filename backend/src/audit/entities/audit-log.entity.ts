import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type AuditLogData = Record<string, unknown> | null;

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId: string | null;

  @Index()
  @Column({ type: 'varchar', length: 120 })
  action: string;

  @Index()
  @Column({ type: 'varchar', length: 80 })
  entity: string;

  @Index()
  @Column({ name: 'entity_id', type: 'varchar', length: 80, nullable: true })
  entityId: string | null;

  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  ipAddress: string | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 512, nullable: true })
  userAgent: string | null;

  @Column({ name: 'before_data', type: 'jsonb', nullable: true })
  beforeData: AuditLogData;

  @Column({ name: 'after_data', type: 'jsonb', nullable: true })
  afterData: AuditLogData;

  @Index()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
