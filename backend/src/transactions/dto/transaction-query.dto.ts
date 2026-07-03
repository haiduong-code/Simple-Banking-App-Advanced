import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export enum TransactionDirection {
  ALL = 'all',
  INCOMING = 'incoming',
  OUTGOING = 'outgoing',
}

export class TransactionQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 10;

  @ApiPropertyOptional({ enum: TransactionDirection, default: 'all' })
  @IsOptional()
  @IsEnum(TransactionDirection)
  direction = TransactionDirection.ALL;
}
