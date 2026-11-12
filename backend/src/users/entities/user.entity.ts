import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Account } from '../../accounts/entities/account.entity';

/** Vai trò người dùng. */
export enum UserRole {
  CUSTOMER = 'customer',
  TELLER = 'teller',
  ADMIN = 'admin',
}

/** Trạng thái tài khoản đăng nhập. */
export enum UserStatus {
  ACTIVE = 'active',
  LOCKED = 'locked',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'full_name', type: 'varchar', length: 255 })
  fullName: string;

  // Email là định danh đăng nhập, phải duy nhất.
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  // Mật khẩu đã hash bằng bcrypt. KHÔNG BAO GIỜ trả ra response.
  @Exclude()
  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash: string;

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.CUSTOMER,
  })
  role: UserRole;

  @Column({
    type: 'enum',
    enum: UserStatus,
    default: UserStatus.ACTIVE,
  })
  status: UserStatus;

  @Exclude()
  @Column({ name: 'token_version', default: 0 })
  tokenVersion: number;

  @Exclude()
  @Column({ name: 'failed_login_count', default: 0 })
  failedLoginCount: number;

  @Exclude()
  @Column({ name: 'last_failed_login_at', type: 'timestamptz', nullable: true })
  lastFailedLoginAt: Date | null;

  @Exclude()
  @Column({
    name: 'failed_login_window_started_at',
    type: 'timestamptz',
    nullable: true,
  })
  failedLoginWindowStartedAt: Date | null;

  @Column({ name: 'locked_until', type: 'timestamptz', nullable: true })
  lockedUntil: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  // Một user có thể sở hữu nhiều tài khoản ngân hàng.
  @OneToMany(() => Account, (account) => account.user)
  accounts: Account[];
}
