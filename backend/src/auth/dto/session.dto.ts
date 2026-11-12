import {
  IsString,
  Length,
  Matches,
  MinLength,
  MaxLength,
} from 'class-validator';
export class RefreshDto {
  @IsString() @Length(64, 64) @Matches(/^[a-f0-9]+$/) refreshToken: string;
}
export class ChangePasswordDto {
  @IsString() @MinLength(1) @MaxLength(72) currentPassword: string;
  @IsString() @MinLength(8) @MaxLength(72) newPassword: string;
}
