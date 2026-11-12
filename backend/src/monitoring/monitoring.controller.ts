import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthUser } from '../auth/strategies/jwt.strategy';
import { UserRole } from '../users/entities/user.entity';
import { ReviewDto } from '../transactions/dto/security.dto';
import { MonitoringService } from './monitoring.service';

@Controller('health')
export class HealthController {
  constructor(private readonly monitoring: MonitoringService) {}
  @Get() health() {
    return this.monitoring.health();
  }
}

@Controller('admin/monitoring')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}
  @Post('reconcile') reconcile() {
    return this.monitoring.reconcile();
  }
  @Get('reports') reports() {
    return this.monitoring.reports();
  }
  @Get('flagged') flagged() {
    return this.monitoring.flagged();
  }
  @Post('flagged/:id/review') review(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ReviewDto,
  ) {
    return this.monitoring.review(id, user.userId, dto.decision);
  }
}
