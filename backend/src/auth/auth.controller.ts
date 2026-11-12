import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { getAuditRequestContext } from '../audit/audit-request-context';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthUser } from './strategies/jwt.strategy';
import { ChangePasswordDto, RefreshDto } from './dto/session.dto';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Đăng ký người dùng + tạo tài khoản mặc định' })
  register(@Body() dto: RegisterDto, @Req() request: Request) {
    return this.authService.register(dto, getAuditRequestContext(request));
  }

  @Post('login')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(200)
  @ApiOperation({ summary: 'Đăng nhập, trả JWT access token' })
  login(@Body() dto: LoginDto, @Req() request: Request) {
    return this.authService.login(dto, getAuditRequestContext(request));
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Thông tin user từ JWT (kiểm tra route được bảo vệ)',
  })
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Post('refresh')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  refresh(@Body() dto: RefreshDto, @Req() request: Request) {
    return this.authService.refresh(
      dto.refreshToken,
      getAuditRequestContext(request),
    );
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  logout(@CurrentUser() user: AuthUser, @Req() request: Request) {
    return this.authService.logout(
      user.userId,
      getAuditRequestContext(request),
    );
  }

  @Post('change-password')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
    @Req() request: Request,
  ) {
    return this.authService.changePassword(
      user.userId,
      dto,
      getAuditRequestContext(request),
    );
  }
}
