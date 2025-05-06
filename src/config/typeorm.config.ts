import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModuleAsyncOptions, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { join } from 'path';

export const typeOrmAsyncConfig: TypeOrmModuleAsyncOptions = {
    imports: [ConfigModule],
    inject: [ConfigService],
    useFactory: async (configService: ConfigService): Promise<TypeOrmModuleOptions> => {
        const nodeEnv = configService.get<string>('NODE_ENV');
        const isTestEnvironment = nodeEnv === 'test';
        const isProductionEnvironment = nodeEnv === 'production';
        const isDevelopmentEnvironment = nodeEnv === 'development';

        const dbType = configService.get<string>('DB_TYPE');
        const dbHost = configService.get<string>('DB_HOST');
        const dbPort = configService.get<number>('DB_PORT'); // TypeORM prefiere número
        const dbUsername = configService.get<string>('DB_USERNAME');
        const dbPassword = configService.get<string>('DB_PASSWORD');
        const dbDatabase = configService.get<string>('DB_DATABASE');
        const typeormLogging = configService.get<boolean>('TYPEORM_LOGGING');
        const typeormSync = configService.get<boolean>('TYPEORM_SYNCHRONIZE');

        const baseOptions = {
            entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
            logging: typeormLogging ?? isDevelopmentEnvironment,
        };

        if (isTestEnvironment) {
            return {
                ...baseOptions,
                type: 'sqlite',
                database: configService.get<string>('DB_DATABASE', ':memory:'),
                synchronize: true,
                migrationsRun: false,
                dropSchema: true,
            };
        } else {

            if (!dbType || !dbHost || !dbPort || !dbUsername || !dbDatabase) {
                throw new Error('Missing required PostgreSQL ENV variables (DB_TYPE, DB_HOST, DB_PORT, DB_USERNAME, DB_DATABASE)');
            }

            return {
                ...baseOptions,
                type: dbType as any,
                host: dbHost,
                port: dbPort,
                username: dbUsername,
                password: dbPassword,
                database: dbDatabase,
                migrations: [join(__dirname, '..', 'database', 'migrations', '*{.ts,.js}')],
                migrationsRun: configService.get<boolean>('TYPEORM_MIGRATIONS_RUN', isProductionEnvironment),
                synchronize: !isProductionEnvironment && (typeormSync ?? false),
                ssl: isProductionEnvironment
                    ? { rejectUnauthorized: configService.get<boolean>('DB_SSL_REJECT_UNAUTHORIZED', false) }
                    : false,
            };
        }
    },
};