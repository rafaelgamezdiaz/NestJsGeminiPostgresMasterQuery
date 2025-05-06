import { DataSource, DataSourceOptions } from 'typeorm';
import * as dotenv from 'dotenv';
import { join } from 'path';

const nodeEnv = process.env.NODE_ENV || 'development';
const envPath = join(process.cwd(), `.env.${nodeEnv}`);
//console.log(`[CLI Config] Loading environment variables for CLI from: ${envPath}`);
dotenv.config({ path: envPath, debug: true });

const getCliDataSourceOptions = (): DataSourceOptions => {
    const currentEnv = process.env.NODE_ENV;

    if (currentEnv === 'test') {
        return {
            type: (process.env.DB_TYPE as any) || 'sqlite',
            database: process.env.DB_DATABASE || 'test.sqlite',
            entities: [join(process.cwd(), 'src', '**', '*.entity.{ts,js}')],
            migrations: [join(process.cwd(), 'src', 'database', 'migrations', '*{.ts,.js}')],
            synchronize: false,
        };
    } else {
        const type = process.env.DB_TYPE as any;
        const host = process.env.DB_HOST;
        const port = parseInt(process.env.DB_PORT || '5432', 10);
        const username = process.env.DB_USERNAME;
        const password = process.env.DB_PASSWORD;
        const database = process.env.DB_DATABASE;

        if (!type || !host || !port || !username || !database) {
            throw new Error('[CLI] Missing required PostgreSQL ENV variables');
        }
        if (type !== 'postgres') {
            throw new Error(`[CLI] Invalid DB_TYPE specified: ${type}`);
        }

        return {
            type: "postgres",
            host: host,
            port: port,
            username: username,
            password: password,
            database: database,
            entities: [join(process.cwd(), 'src', '**', '*.entity.{ts,js}')],
            migrations: [join(process.cwd(), 'src', 'database', 'migrations', '*{.ts,.js}')],
            migrationsTableName: "migrations",
            synchronize: false,
            ssl: currentEnv === 'production'
                ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true' }
                : false,
        };
    }
};

const cliDataSourceOptions = getCliDataSourceOptions();
export default new DataSource(cliDataSourceOptions);