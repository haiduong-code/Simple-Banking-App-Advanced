import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { AccountsService } from '../accounts/accounts.service';
import { AuditRequestContext } from '../audit/audit-request-context';
import { AuditService } from '../audit/audit.service';
import { User, UserStatus } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/session.dto';
import { RefreshSession } from './entities/refresh-session.entity';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly accountsService: AccountsService,
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  private async issue(
    user: User,
    manager: EntityManager,
    context?: AuditRequestContext,
  ) {
    const refreshToken = randomBytes(32).toString('hex');
    await manager.getRepository(RefreshSession).save({
      userId: user.id,
      tokenHash: this.hash(refreshToken),
      tokenVersion: user.tokenVersion,
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent?.slice(0, 512),
    });
    return {
      accessToken: this.jwtService.sign(
        {
          sub: user.id,
          email: user.email,
          role: user.role,
          version: user.tokenVersion,
          tokenUse: 'access',
        },
        { expiresIn: 900 },
      ),
      refreshToken,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
      },
    };
  }

  async register(dto: RegisterDto, context?: AuditRequestContext) {
    return this.dataSource.transaction(async (manager) => {
      const user = await this.usersService.create(
        {
          fullName: dto.fullName.trim(),
          email: dto.email.trim(),
          password: dto.password,
        },
        manager,
      );
      await this.accountsService.createForUser(user.id, '0.00', manager);
      await this.auditService.logInTransaction(
        'auth.register.success',
        { actorId: user.id, entity: 'User', entityId: user.id, ...context },
        manager,
      );
      return this.issue(user, manager, context);
    });
  }

  async login(dto: LoginDto, context?: AuditRequestContext) {
    const candidate = await this.usersService.findByEmail(dto.email);
    if (!candidate) {
      await this.auditService.log('auth.login.failed', {
        entity: 'User',
        ...context,
        afterData: { reason: 'invalid_credentials' },
      });
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }
    const result = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(User);
      const user = await repository.findOne({
        where: { id: candidate.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user || user.status !== UserStatus.ACTIVE)
        return { error: 'Tài khoản đã bị khóa' };
      if (user.lockedUntil && user.lockedUntil.getTime() > Date.now())
        return {
          error: 'Tài khoản tạm khóa 1 phút do đăng nhập sai nhiều lần',
        };
      if (
        !(await this.usersService.comparePassword(
          dto.password,
          user.passwordHash,
        ))
      ) {
        const now = new Date();
        const inWindow =
          user.failedLoginWindowStartedAt &&
          now.getTime() - user.failedLoginWindowStartedAt.getTime() < 60_000;
        user.failedLoginCount = inWindow ? user.failedLoginCount + 1 : 1;
        if (!inWindow) user.failedLoginWindowStartedAt = now;
        user.lastFailedLoginAt = now;
        if (user.failedLoginCount >= 5)
          user.lockedUntil = new Date(now.getTime() + 60_000);
        await repository.save(user);
        await this.auditService.logInTransaction(
          'auth.login.failed',
          {
            actorId: user.id,
            entity: 'User',
            entityId: user.id,
            ...context,
            afterData: {
              attempts: user.failedLoginCount,
              lockedUntil: user.lockedUntil,
            },
          },
          manager,
        );
        return {
          error:
            user.failedLoginCount >= 5
              ? 'Tài khoản tạm khóa 1 phút do đăng nhập sai nhiều lần'
              : 'Email hoặc mật khẩu không đúng',
        };
      }
      user.failedLoginCount = 0;
      user.failedLoginWindowStartedAt = null;
      user.lockedUntil = null;
      await repository.save(user);
      await this.auditService.logInTransaction(
        'auth.login.success',
        { actorId: user.id, entity: 'User', entityId: user.id, ...context },
        manager,
      );
      return { auth: await this.issue(user, manager, context) };
    });
    if (result.error) throw new UnauthorizedException(result.error);
    return result.auth;
  }

  async refresh(token: string, context?: AuditRequestContext) {
    const result = await this.dataSource.transaction(async (manager) => {
      const sessions = manager.getRepository(RefreshSession);
      const candidate = await sessions.findOne({
        where: { tokenHash: this.hash(token) },
      });
      if (!candidate) return null;
      const user = await manager.getRepository(User).findOne({
        where: { id: candidate.userId },
        lock: { mode: 'pessimistic_write' },
      });
      const session = await sessions.findOne({
        where: { id: candidate.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user || user.status !== UserStatus.ACTIVE) return null;
      if (
        session.revokedAt ||
        session.expiresAt.getTime() <= Date.now() ||
        session.tokenVersion !== user.tokenVersion
      ) {
        await this.revokeAll(user, manager);
        await this.auditService.logInTransaction(
          'auth.refresh.rejected',
          { actorId: user.id, entity: 'User', entityId: user.id, ...context },
          manager,
        );
        return null;
      }
      session.revokedAt = new Date();
      await sessions.save(session);
      return this.issue(user, manager, context);
    });
    if (!result)
      throw new UnauthorizedException(
        'Refresh token hết hạn hoặc đã bị thu hồi',
      );
    return result;
  }

  async logout(userId: string, context?: AuditRequestContext) {
    await this.dataSource.transaction(async (manager) => {
      const user = await manager.getRepository(User).findOneOrFail({
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      await this.revokeAll(user, manager);
      await this.auditService.logInTransaction(
        'auth.logout',
        { actorId: userId, entity: 'User', entityId: userId, ...context },
        manager,
      );
    });
    return { revoked: true };
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    context?: AuditRequestContext,
  ) {
    await this.dataSource.transaction(async (manager) => {
      const user = await manager.getRepository(User).findOneOrFail({
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash)))
        throw new BadRequestException('Mật khẩu hiện tại không đúng');
      user.passwordHash = await bcrypt.hash(dto.newPassword, 10);
      await this.revokeAll(user, manager);
      await this.auditService.logInTransaction(
        'auth.password.changed',
        { actorId: userId, entity: 'User', entityId: userId, ...context },
        manager,
      );
    });
    return { changed: true };
  }

  private hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
  private async revokeAll(user: User, manager: EntityManager) {
    user.tokenVersion++;
    await manager.getRepository(User).save(user);
    await manager
      .getRepository(RefreshSession)
      .update(
        { userId: user.id, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
  }
}
