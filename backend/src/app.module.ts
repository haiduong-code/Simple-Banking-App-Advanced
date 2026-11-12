import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { BankingSubscriber } from './database/banking.subscriber';
import { DatabaseIntegrityService } from './database/database-integrity.service';
import { RequestContextMiddleware } from './common/request-context';
import { MonitoringModule } from './monitoring/monitoring.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminModule } from './admin/admin.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AccountsModule } from './accounts/accounts.module';
import { AuditModule } from './audit/audit.module';
import { TransactionsModule } from './transactions/transactions.module';
import { LedgerModule } from './ledger/ledger.module';
import * as Joi from 'joi';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        DB_HOST: Joi.string().required(),
        DB_PORT: Joi.number().default(5432),
        DB_USER: Joi.string().required(),
        DB_PASSWORD: Joi.string().required(),
        DB_NAME: Joi.string().required(),
        JWT_SECRET: Joi.string().required(),
        JWT_EXPIRES_IN: Joi.string().default('15m'),
        BANKING_LOCK_MODE: Joi.string()
          .valid('pessimistic', 'optimistic')
          .default('pessimistic'),
        DB_SYNCHRONIZE: Joi.boolean().default(true),
        CORS_ORIGIN: Joi.string().uri().default('http://localhost:5173'),
        PORT: Joi.number().default(3000),
      }),
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DB_HOST'),
        port: +config.get<number>('DB_PORT', 5432),
        username: config.get('DB_USER'),
        password: config.get('DB_PASSWORD'),
        database: config.get('DB_NAME'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        subscribers: [BankingSubscriber],
        synchronize: config.get<boolean>('DB_SYNCHRONIZE', true),
        logging: false,
        extra: { connectionTimeoutMillis: 3000, max: 30 },
      }),
      inject: [ConfigService],
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60000, limit: 60 },
      {
        name: 'user',
        ttl: 60000,
        limit: 30,
        getTracker: (req: { user?: { userId: string }; ip: string }) =>
          req.user?.userId ?? req.ip,
      },
    ]),
    UsersModule,
    AccountsModule,
    AuthModule,
    AuditModule,
    LedgerModule,
    TransactionsModule,
    AdminModule,
    MonitoringModule,
  ],
  controllers: [AppController],
  providers: [AppService, DatabaseIntegrityService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
