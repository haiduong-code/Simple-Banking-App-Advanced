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
}
