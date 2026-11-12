import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { User, UserStatus } from '../../users/entities/user.entity';
import { UsersService } from '../../users/users.service';
import { requestContext } from '../../common/request-context';

/** Payload mã hóa trong JWT. */
export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  version: number;
  tokenUse: string;
}

/** Đối tượng user gắn vào request sau khi xác thực. */
export interface AuthUser {
  userId: string;
  email: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET'),
    });
  }

  /**
   * Được gọi sau khi token hợp lệ. Tải lại user để chắc chắn còn tồn tại
   * và chưa bị khóa (token cũ không qua mặt được trạng thái mới).
   */
  async validate(payload: JwtPayload): Promise<AuthUser> {
    let user: User;
    try {
      user = await this.usersService.findById(payload.sub);
    } catch {
      throw new UnauthorizedException('Token không hợp lệ');
    }
    if (
      user.status === UserStatus.LOCKED ||
      payload.tokenUse !== 'access' ||
      payload.version !== user.tokenVersion
    ) {
      throw new UnauthorizedException(
        'Phiên đăng nhập hết hạn, bị thu hồi hoặc tài khoản đã bị khóa',
      );
    }
    const context = requestContext.getStore();
    if (context) context.actorId = user.id;
    return { userId: user.id, email: user.email, role: user.role };
  }
}
