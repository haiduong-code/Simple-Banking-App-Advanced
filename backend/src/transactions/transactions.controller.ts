import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { isUUID } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthUser } from '../auth/strategies/jwt.strategy';
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
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (!idempotencyKey || !isUUID(idempotencyKey, '4')) {
      throw new BadRequestException('Idempotency-Key phải là UUID v4 hợp lệ');
    }
    return this.transactionsService.transfer(user.userId, dto, idempotencyKey);
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
