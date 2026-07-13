import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountHistory } from '../accounts/entities/account-history.entity';
import { Account } from '../accounts/entities/account.entity';
import { AuditModule } from '../audit/audit.module';
import { UserHistory } from './entities/user-history.entity';
import { User } from './entities/user.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserHistory, Account, AccountHistory]),
    AuditModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
