import { Controller, Get } from '@nestjs/common';
import { DbSchemaService } from './db-schema.service'; // Ajusta la ruta según tu estructura

@Controller('schema')
export class DbSchemaController {
    constructor(private readonly dbSchemaService: DbSchemaService) { }

    @Get('get-schema')
    async getSchema() {
        return await this.dbSchemaService.getDbSchema();
    }
}