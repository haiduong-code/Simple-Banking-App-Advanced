import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';

export type UserHistoryData = Record<string, unknown>;

@Entity('user_history')
export class UserHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Index()
  @Column({ name: 'changed_by_id', type: 'uuid', nullable: true })
  changedById: string | null;

  @Index()
  @Column({ type: 'varchar', length: 80 })
  action: string;

  @Column({ name: 'before_data', type: 'jsonb' })
  beforeData: UserHistoryData;

  @Column({ name: 'after_data', type: 'jsonb', nullable: true })
  afterData: UserHistoryData | null;

  @Index()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
