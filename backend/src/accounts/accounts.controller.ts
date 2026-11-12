import {
  Controller,
  Body,
  Patch,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountsService } from './accounts.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthUser } from '../auth/strategies/jwt.strategy';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';
import { AccountHistoryQueryDto } from './dto/account-history-query.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

@ApiTags('accounts')
@Controller('accounts')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get('me')
  @ApiOperation({
    summary: 'Lấy thông tin tài khoản và số dư của user hiện tại',
  })
  async getMyAccount(@CurrentUser() user: AuthUser) {
    const account = await this.accountsService.findByUserId(user.userId);
    return this.accountsService.toPublicResult(account);
  }

  @Get(':id/history')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Xem lịch sử thay đổi account, chỉ dành cho admin',
  })
  getAccountHistory(
    @Param('id', new ParseUUIDPipe({ version: '4' })) accountId: string,
    @Query() query: AccountHistoryQueryDto,
  ) {
    return this.accountsService.findHistory(accountId, query);
  }

  @Get(':id')
  getAccount(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.accountsService.findForActor(id, user.userId, user.role);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  updateAccount(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateAccountDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.accountsService.updateSettings(id, dto, user.userId);
  }
}
