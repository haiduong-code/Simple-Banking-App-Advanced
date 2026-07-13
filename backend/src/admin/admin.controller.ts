import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { getAuditRequestContext } from '../audit/audit-request-context';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthUser } from '../auth/strategies/jwt.strategy';
import { UserRole } from '../users/entities/user.entity';
import { AdminService } from './admin.service';
import { AdminTransactionsQueryDto } from './dto/admin-transactions-query.dto';
import { AdminUsersQueryDto } from './dto/admin-users-query.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  @ApiOperation({ summary: 'Danh sách user, chỉ dành cho admin' })
  findUsers(@Query() query: AdminUsersQueryDto) {
    return this.adminService.findUsers(query);
  }

  @Delete('users/:id')
  @ApiOperation({ summary: 'Soft delete user, chỉ dành cho admin' })
  softDeleteUser(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) userId: string,
    @Req() request: Request,
  ) {
    return this.adminService.softDeleteUser(
      userId,
      user.userId,
      getAuditRequestContext(request),
    );
  }

  @Delete('accounts/:id')
  @ApiOperation({ summary: 'Soft delete account, chỉ dành cho admin' })
  softDeleteAccount(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) accountId: string,
    @Req() request: Request,
  ) {
    return this.adminService.softDeleteAccount(
      accountId,
      user.userId,
      getAuditRequestContext(request),
    );
  }

  @Patch('users/:id/status')
  @ApiOperation({ summary: 'Khóa hoặc mở tài khoản user, chỉ dành cho admin' })
  updateUserStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) userId: string,
    @Body() dto: UpdateUserStatusDto,
    @Req() request: Request,
  ) {
    return this.adminService.updateUserStatus(
      userId,
      dto,
      user.userId,
      getAuditRequestContext(request),
    );
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Xem toàn bộ giao dịch, chỉ dành cho admin' })
  findTransactions(@Query() query: AdminTransactionsQueryDto) {
    return this.adminService.findTransactions(query);
  }
}
