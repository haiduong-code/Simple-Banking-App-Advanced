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

@ApiTags('transactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post('transfer')
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
    // TODO(Module 4): thay JwtAuthGuard-only bằng RolesGuard khi hoàn thiện RBAC admin/teller.
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
}
