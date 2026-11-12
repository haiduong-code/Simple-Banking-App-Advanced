import { IsEnum, IsOptional } from 'class-validator';
import { AccountStatus, AccountTier } from '../entities/account.entity';
export class UpdateAccountDto {
  @IsOptional() @IsEnum(AccountStatus) status?: AccountStatus;
  @IsOptional() @IsEnum(AccountTier) tier?: AccountTier;
}
