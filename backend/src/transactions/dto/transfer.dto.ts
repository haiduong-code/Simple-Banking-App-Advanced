import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class TransferDto {
  @ApiPropertyOptional({
    description: 'Teller/admin: tài khoản nguồn của khách hàng',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{10}$/)
  fromAccountNumber?: string;
  @ApiProperty({ example: '9123456789' })
  @IsString()
  @Matches(/^\d{10}$/, { message: 'Số tài khoản đích phải gồm 10 chữ số' })
  toAccountNumber: string;

  @ApiProperty({ example: '150000.00', type: String })
  @IsString()
  @Matches(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/, {
    message: 'Số tiền phải là decimal hợp lệ, tối đa 2 chữ số thập phân',
  })
  amount: string;

  @ApiPropertyOptional({ example: 'Thanh toán tiền ăn' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  description?: string;
}
