import {
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
export class VerifyOtpDto {
  @IsString() @Matches(/^\d{6}$/) code: string;
}
export enum ReviewDecision {
  APPROVED = 'approved',
  REJECTED = 'rejected',
}
export class ReviewDto {
  @IsEnum(ReviewDecision) decision: ReviewDecision;
}
export class CashDto {
  @IsString() @Matches(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/) amount: string;
  @IsOptional() @IsString() @Matches(/^\d{10}$/) fromAccountNumber?: string;
  @IsOptional() @IsString() @MaxLength(255) description?: string;
}
