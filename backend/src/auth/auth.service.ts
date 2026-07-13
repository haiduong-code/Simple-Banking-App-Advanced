import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { AccountsService } from '../accounts/accounts.service';
import { AuditRequestContext } from '../audit/audit-request-context';
import { AuditService } from '../audit/audit.service';
import { User, UserStatus } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

/** Dữ liệu user trả về client — KHÔNG chứa password_hash. */
export interface SafeUser {
  id: string;
  fullName: string;
  email: string;
  role: string;
  status: string;
  createdAt: Date;
}

export interface AuthResult {
  accessToken: string;
  user: SafeUser;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly accountsService: AccountsService,
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  /** Loại bỏ trường nhạy cảm trước khi trả ra response. */
  private toSafeUser(user: User): SafeUser {
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
    };
  }

  private signToken(user: User): string {
    return this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
  }

  /**
   * Đăng ký: tạo user (hash bcrypt) + tự sinh 1 tài khoản mặc định,
   * rồi trả JWT để đăng nhập ngay.
   */
  async register(
    dto: RegisterDto,
    auditContext?: AuditRequestContext,
  ): Promise<AuthResult> {
    const user = await this.dataSource.transaction(async (manager) => {
      const createdUser = await this.usersService.create(
        {
          fullName: dto.fullName.trim(),
          email: dto.email.trim(),
          password: dto.password,
        },
        manager,
      );

      // User và tài khoản mặc định phải cùng thành công hoặc cùng rollback.
      const account = await this.accountsService.createForUser(
        createdUser.id,
        '0.00',
        manager,
      );
      await this.auditService.logInTransaction(
        'auth.register.success',
        {
          actorId: createdUser.id,
          entity: 'User',
          entityId: createdUser.id,
          ...auditContext,
          afterData: {
            userId: createdUser.id,
            email: createdUser.email,
            role: createdUser.role,
            status: createdUser.status,
            accountId: account.id,
            accountNumber: account.accountNumber,
          },
        },
        manager,
      );

      return createdUser;
    });

    return {
      accessToken: this.signToken(user),
      user: this.toSafeUser(user),
    };
  }

  /**
   * Đăng nhập: kiểm tra email + mật khẩu, chặn tài khoản bị khóa,
   * trả JWT access token.
   */
  async login(
    dto: LoginDto,
    auditContext?: AuditRequestContext,
  ): Promise<AuthResult> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.usersService.findByEmail(email);

    // Thông báo chung chung để tránh lộ email nào tồn tại.
    if (!user) {
      await this.auditService.log('auth.login.failed', {
        actorId: null,
        entity: 'User',
        entityId: null,
        ...auditContext,
        afterData: {
          email,
          reason: 'user_not_found',
        },
      });
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }

    const passwordOk = await this.usersService.comparePassword(
      dto.password,
      user.passwordHash,
    );
    if (!passwordOk) {
      await this.auditService.log('auth.login.failed', {
        actorId: user.id,
        entity: 'User',
        entityId: user.id,
        ...auditContext,
        afterData: {
          userId: user.id,
          email: user.email,
          reason: 'invalid_password',
        },
      });
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }

    if (user.status === UserStatus.LOCKED) {
      await this.auditService.log('auth.login.failed', {
        actorId: user.id,
        entity: 'User',
        entityId: user.id,
        ...auditContext,
        afterData: {
          userId: user.id,
          email: user.email,
          status: user.status,
          reason: 'locked',
        },
      });
      throw new UnauthorizedException('Tài khoản đã bị khóa');
    }

    await this.auditService.log('auth.login.success', {
      actorId: user.id,
      entity: 'User',
      entityId: user.id,
      ...auditContext,
      afterData: {
        userId: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
      },
    });

    return {
      accessToken: this.signToken(user),
      user: this.toSafeUser(user),
    };
  }
}
