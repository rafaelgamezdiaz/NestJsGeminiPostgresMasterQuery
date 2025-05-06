import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GeminiService } from './gemini/gemini.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { typeOrmAsyncConfig } from './config/typeorm.config';
import { DbSchemaService } from './dbSchema/db-schema.service';
import { DbSchemaController } from './dbSchema/db-schema.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `.env.development`,
    }),
    TypeOrmModule.forRootAsync(typeOrmAsyncConfig), // envFilePath: `.env.${process.env.NODE_ENV || 'development'}`,
  ],
  controllers: [AppController, DbSchemaController],
  providers: [AppService, GeminiService, DbSchemaService],
  exports: [GeminiService, DbSchemaService],
})
export class AppModule { }
