import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
@Entity('refresh_sessions')
export class RefreshSession {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @Index({ unique: true })
  @Column({ name: 'token_hash', type: 'varchar', length: 64, select: false })
  tokenHash: string;
  @Column({ name: 'token_version', type: 'integer' }) tokenVersion: number;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt: Date;
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;
  @Column({ name: 'ip_address', type: 'varchar', nullable: true }) ipAddress:
    string | null;
  @Column({ name: 'user_agent', type: 'varchar', nullable: true }) userAgent:
    string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
