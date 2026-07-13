import {
  Body,
  Controller,
  Get,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { getAuditRequestContext } from '../audit/audit-request-context';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthUser } from '../auth/strategies/jwt.strategy';
import { UpdateMeDto } from './dto/update-me.dto';
import { UserHistoryQueryDto } from './dto/user-history-query.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Patch('me')
  @ApiOperation({ summary: 'Cập nhật hồ sơ user hiện tại' })
  updateMe(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateMeDto,
    @Req() request: Request,
  ) {
    return this.usersService.updateProfile(
      user.userId,
      dto,
      user.userId,
      getAuditRequestContext(request),
    );
  }

  @Get('me/history')
  @ApiOperation({ summary: 'Xem lịch sử thay đổi hồ sơ của user hiện tại' })
  getMyHistory(
    @CurrentUser() user: AuthUser,
    @Query() query: UserHistoryQueryDto,
  ) {
    return this.usersService.findHistory(user.userId, query);
  }
}
