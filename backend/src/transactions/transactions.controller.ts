import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { isUUID } from 'class-validator';
import { Request } from 'express';
import { getAuditRequestContext } from '../audit/audit-request-context';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthUser } from '../auth/strategies/jwt.strategy';
import { ReverseTransactionDto } from './dto/reverse-transaction.dto';
import { TransactionQueryDto } from './dto/transaction-query.dto';
import { TransferDto } from './dto/transfer.dto';
import { TransactionsService } from './transactions.service';
import { BankingOperationsService } from './banking-operations.service';
import { CashDto, VerifyOtpDto } from './dto/security.dto';
import { TransactionType } from './entities/transaction.entity';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';
import { ThrottlerGuard } from '@nestjs/throttler';

@ApiTags('transactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('transactions')
export class TransactionsController {
  constructor(
    private readonly transactionsService: TransactionsService,
    private readonly operations: BankingOperationsService,
  ) {}

  @Post('transfer')
  @UseGuards(ThrottlerGuard)
  @ApiOperation({ summary: 'Chuyển khoản nội bộ an toàn và idempotent' })
  @ApiHeader({
    name: 'Idempotency-Key',
    description: 'UUID v4 mới cho mỗi lần người dùng chủ động chuyển khoản',
    required: true,
  })
  transfer(
    @CurrentUser() user: AuthUser,
    @Body() dto: TransferDto,
    @Req() request: Request,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (!idempotencyKey || !isUUID(idempotencyKey, '4')) {
      throw new BadRequestException('Idempotency-Key phải là UUID v4 hợp lệ');
    }
    return this.transactionsService.transfer(
      user.userId,
      dto,
      idempotencyKey,
      getAuditRequestContext(request),
    );
  }

  @Post(':id/reverse')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Tạo yêu cầu hoàn tiền/reversal cho một giao dịch',
  })
  @ApiParam({
    name: 'id',
    description: 'UUID của transaction gốc cần hoàn tiền',
  })
  reverseTransaction(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) transactionId: string,
    @Body() dto: ReverseTransactionDto,
    @Req() request: Request,
  ) {
    return this.transactionsService.reverseTransaction(
      user.userId,
      transactionId,
      dto,
      getAuditRequestContext(request),
    );
  }

  @Get()
  @ApiOperation({
    summary: 'Lịch sử giao dịch có phân trang và lọc chiều tiền',
  })
  getHistory(
    @CurrentUser() user: AuthUser,
    @Query() query: TransactionQueryDto,
  ) {
    return this.transactionsService.getHistory(user.userId, query);
  }

  @Post('withdraw')
  @UseGuards(ThrottlerGuard)
  withdraw(
    @CurrentUser() user: AuthUser,
    @Body() dto: CashDto,
    @Headers('idempotency-key') key: string,
    @Req() request: Request,
  ) {
    this.validateKey(key);
    return this.operations.start(
      user.userId,
      dto,
      key,
      TransactionType.WITHDRAWAL,
      getAuditRequestContext(request),
    );
  }

  @Post('deposit')
  @UseGuards(RolesGuard, ThrottlerGuard)
  @Roles(UserRole.TELLER, UserRole.ADMIN)
  deposit(
    @CurrentUser() user: AuthUser,
    @Body() dto: CashDto,
    @Headers('idempotency-key') key: string,
    @Req() request: Request,
  ) {
    this.validateKey(key);
    return this.operations.start(
      user.userId,
      dto,
      key,
      TransactionType.DEPOSIT,
      getAuditRequestContext(request),
    );
  }

  @Post(':id/verify-otp')
  @UseGuards(ThrottlerGuard)
  verifyOtp(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: VerifyOtpDto,
  ) {
    return this.operations.verifyOtp(user.userId, id, dto.code);
  }

  @Post(':id/approve')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.operations.approve(user.userId, id, true);
  }

  @Post(':id/reject')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.operations.approve(user.userId, id, false);
  }

  @Get(':id')
  getTransaction(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.operations.getForUser(user.userId, id);
  }

  private validateKey(key: string) {
    if (!key || !isUUID(key, '4'))
      throw new BadRequestException('Idempotency-Key phải là UUID v4 hợp lệ');
  }
}
