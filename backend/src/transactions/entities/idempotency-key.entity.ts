import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('idempotency_keys')
export class IdempotencyKey {
  @PrimaryColumn('uuid') key: string;
  @Column({ name: 'actor_id', type: 'uuid' }) actorId: string;
  @Column({ name: 'request_hash', type: 'varchar', length: 64 })
  requestHash: string;
  @Column({ type: 'jsonb' }) response: Record<string, unknown>;
  @Column({ name: 'response_code', type: 'integer' }) responseCode: number;
  @Column({ type: 'varchar', default: 'completed' }) status: string;
  @Column({ name: 'expired_at', type: 'timestamptz' }) expiredAt: Date;
}
