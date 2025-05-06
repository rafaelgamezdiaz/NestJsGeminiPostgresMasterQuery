import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";

// Define la interfaz aquí o en un archivo .d.ts
export interface DbColumnInfo {
  table_name: string;
  column_name: string;
  data_type: string;
}

@Injectable()
export class DbSchemaService {

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) { }

  async getDbSchema(): Promise<any> {
    const query = `
          SELECT table_name, column_name, data_type
          FROM information_schema.columns
          WHERE table_schema = 'public'
          ORDER BY table_name, ordinal_position;
        `;

    // TypeORM puede inferir el tipo a veces, pero puedes castear si es necesario
    const results: DbColumnInfo[] = await this.dataSource.query(query);
    return results;
    //return await this.dataSource.query(query);
  }
}