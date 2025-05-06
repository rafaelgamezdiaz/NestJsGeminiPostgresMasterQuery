import { DataSource } from 'typeorm';
import { GoogleGenAI } from '@google/genai';
import { ConfigService } from '@nestjs/config';
import { Injectable, Logger, ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { DbSchemaService, DbColumnInfo } from 'src/dbSchema/db-schema.service';

export class ForbiddenSqlOperationError extends ForbiddenException {
    constructor(message = 'No puedo realizar esa acción. Solo puedo ayudarte a buscar y consultar información, pero no a modificarla o eliminarla.') {
        super(message);
        this.name = 'ForbiddenSqlOperationError';
    }
}

@Injectable()
export class GeminiService {

    private ai: GoogleGenAI;
    private aiGeminiModel: string;
    private readonly forbiddenSqlKeywords = new Set([
        'DELETE', 'UPDATE', 'INSERT', 'DROP', 'ALTER', 'TRUNCATE',
        'CREATE', 'GRANT', 'REVOKE', 'EXEC', 'EXECUTE', 'SET', 'MERGE'
    ]);

    private formattedDbSchema: string; // Formatted DB schema
    private readonly logger = new Logger(GeminiService.name);

    constructor(
        private configService: ConfigService,
        private dbSchemaService: DbSchemaService,
        private dataSource: DataSource
    ) {

        // Get API key from configuration file
        const apiKey = this.configService.get<string>('GEMINI_API_KEY');
        this.aiGeminiModel = this.configService.get<string>('GEMINI_MODEL', 'gemini-2.0-flash-001');

        // init GoogleGenAI instance
        this.ai = new GoogleGenAI({ apiKey });
    }

    async onModuleInit() {
        try {
            // Get the DB schema and format it for the prompt
            const rawSchema = await this.dbSchemaService.getDbSchema();
            this.formattedDbSchema = this.formatSchemaForPrompt(rawSchema);
        } catch (error) {
            this.formattedDbSchema = '';
        }
    }

    /**
     * 
     * @param userQuestion 
     * @returns 
     */
    async getGeminiResponse(userQuestion: string) {

        try {
            // 1. Generar la consulta SQL segura
            const sqlQuery = await this.getSQLQueryFromQuestion(userQuestion);
            //   this.logger.log(`Safely generated SQL: ${sqlQuery}`);

            // 2. Ejecutar la consulta SQL
            const queryResults = await this.executeQuery(sqlQuery);
            //  this.logger.log(`Query executed successfully. Result count: ${queryResults?.length ?? 0}`);

            // 3. Obtener la explicación en lenguaje natural
            const finalExplanation = await this.getHumanReadableExplanation(userQuestion, queryResults);
            this.logger.log(`Generated final explanation for user.`);

            return finalExplanation;

        } catch (error) {
            // Manejar errores específicos o generales
            if (error instanceof ForbiddenSqlOperationError) {
                this.logger.warn(`Process stopped: ${error.message}`);
                // Puedes optar por devolver el mensaje de error directamente al usuario
                // o lanzar la excepción para que la maneje un controlador superior
                throw error; // Relanzar para que el controlador decida (ej: devolver 403)
                // return error.message; // Alternativa: devolver mensaje directo
            } else if (error instanceof InternalServerErrorException) {
                // Errores esperados durante la ejecución o explicación
                this.logger.error(`Error during query execution or explanation phase: ${error.message}`, error.stack);
                throw error; // Relanzar para que el controlador decida (ej: devolver 500)
            }
            else {
                // Errores inesperados
                this.logger.error(`Unexpected error in getGeminiResponse flow: ${error.message}`, error.stack);
                throw new InternalServerErrorException('Ocurrió un error inesperado al procesar tu solicitud.');
            }
        }
    }

    /**
    * Executes a given SQL query.
    * IMPORTANT: Assumes the query has already been validated as safe (read-only).
    * @param sqlQuery The safe SQL query string to execute.
    * @returns The results from the database.
    */
    private async executeQuery(sqlQuery: string): Promise<any[]> {
        try {
            // Use the query runner from your DataSource
            const results = await this.dataSource.query(sqlQuery);
            return results;
        } catch (dbError) {
            this.logger.error(`Database query execution failed for query "${sqlQuery}": ${dbError.message}`, dbError.stack);
            // Throw a more generic error to avoid exposing DB details
            throw new InternalServerErrorException('Error al ejecutar la consulta en la base de datos.');
        }
    }


    /**
   * Generates a human-readable explanation of query results using Gemini.
   * @param originalQuestion The user's initial question.
   * @param queryResults The data obtained from executing the SQL query.
   * @returns A natural language explanation.
   */
    private async getHumanReadableExplanation(originalQuestion: string, queryResults: any): Promise<string> {
        // Formatear los resultados para incluirlos en el prompt (JSON es una buena opción)
        // Considera limitar el tamaño si los resultados pueden ser muy grandes
        const resultsString = JSON.stringify(queryResults, null, 2); // Pretty print JSON

        // Limitar longitud si es necesario para no exceder limites del prompt
        const maxResultsLength = 3000; // Ajusta según necesidad/límites de Gemini
        const truncatedResultsString = resultsString.length > maxResultsLength
            ? resultsString.substring(0, maxResultsLength) + "\n... (resultados truncados)"
            : resultsString;

        const promptForExplanation = this.makeExplanationPrompt(originalQuestion, truncatedResultsString);
        this.logger.debug(`Generated Explanation Prompt:\n---\n${promptForExplanation}\n---`);

        try {
            const finalResponse = await this.ai.models.generateContent({
                model: this.aiGeminiModel,
                contents: promptForExplanation,
            });

            let finalGeneratedText: string | undefined = undefined;

            // Get the generated text from the response
            if (finalResponse &&
                finalResponse.candidates && finalResponse.candidates.length > 0 &&
                finalResponse.candidates[0].content &&
                finalResponse.candidates[0].content.parts && finalResponse.candidates[0].content.parts.length > 0) {
                finalGeneratedText = finalResponse.candidates[0].content.parts[0].text;
            } else {
                throw new Error('Failed to parse Gemini response structure.');
            }

            if (!finalGeneratedText) {
                this.logger.error('Gemini response for explanation is empty.');
                throw new Error('No se pudo obtener respuesta.');
            }


            return finalGeneratedText.trim();

        } catch (error) {
            this.logger.error(`Error calling Gemini for explanation: ${error.message}`, error.stack);
            throw new InternalServerErrorException('Error al generar la explicación final de los resultados.');
        }
    }


    /**
    * Creates the prompt for the second Gemini call (generating the explanation).
    * @param userQuestion
    * @param resultsString
    * @returns
    */
    private makeExplanationPrompt(userQuestion: string, resultsString: string): string {
        return `
           Contexto: Eres un asistente de IA amigable y servicial. Tu tarea es explicar los resultados de una consulta a base de datos de forma clara y concisa para un usuario final, basándote en su pregunta original.
           El usuario NO debe saber sobre SQL o bases de datos.

           Pregunta Original del Usuario: "${userQuestion}"

           Resultados de la Consulta (en formato JSON):
           ---
           ${resultsString}
           ---

           Instrucciones para la Respuesta:
           1.  Analiza la Pregunta Original y los Resultados de la Consulta.
           2.  Genera una respuesta en lenguaje natural que conteste DIRECTAMENTE a la Pregunta Original del Usuario utilizando la información de los Resultados.
           3.  Sé claro, conciso y utiliza un tono amigable.
           4.  **NO menciones NUNCA "SQL", "consulta", "base de datos", "query", "JSON", "registros" o "columnas".** Habla como si simplemente tuvieras la información solicitada.
           5.  Si los resultados están vacíos (ej: "[]"), indica de forma amable que no se encontró información que coincida con lo solicitado. Ejemplo: "Parece que no hay datos sobre [tema de la pregunta] en este momento."
           6.  Si la pregunta buscaba un único valor (ej: "el que más vendió", "el producto más barato") pero los resultados muestran varios empates, indícalo claramente. Ejemplo: "Hay varios usuarios empatados como los que más vendieron: [Usuario A], [Usuario B] vendieron [X] productos cada uno." o "Varios productos comparten el precio más bajo: [Producto X] y [Producto Y] cuestan [Precio]."
           7.  Si los resultados fueron truncados (contienen "... (resultados truncados)"), puedes mencionar que hay más resultados de los que se muestran si es relevante para la pregunta (ej: "Aquí están algunos de los productos más vendidos: ..."), pero no te enfoques en el truncamiento en sí.
           8.  **Responde SOLAMENTE con la explicación final para el usuario.** Sin saludos genéricos ("Hola"), sin frases introductorias ("Aquí tienes la respuesta:"), ni despedidas. Solo el texto de la explicación.

           Explicación para el Usuario:
           `;
    }


    /**
     * Formats the database schema for the prompt.
     * @param schemaData 
     * @returns 
     */
    private formatSchemaForPrompt(schemaData: DbColumnInfo[]): string {
        if (!schemaData || schemaData.length === 0) {
            return 'No schema information available.';
        }

        const tables: { [tableName: string]: { column_name: string; data_type: string }[] } = {};

        // Groups columns by table name
        schemaData.forEach(column => {
            if (!tables[column.table_name]) {
                tables[column.table_name] = [];
            }
            tables[column.table_name].push({ column_name: column.column_name, data_type: column.data_type });
        });

        // Builds a formatted string for the schema
        let formattedString = 'Database Schema:\n';
        for (const tableName in tables) {
            formattedString += `Table: ${tableName}\n`;
            formattedString += `  Columns:\n`;
            tables[tableName].forEach(col => {
                formattedString += `    - ${col.column_name}: ${col.data_type}\n`;
            });
            formattedString += '\n'; // table separation
        }

        return formattedString.trim() || 'No schema information available.';
    }

    /**
    * Sends a user question and the DB schema to Gemini to generate an SQL query.
    * @param userQuestion - The question in natural langiage (ej: "What were the three best-selling products?").
    * @returns The generated SQL query as a string.
    */
    async getSQLQueryFromQuestion(userQuestion: string): Promise<string> {
        if (!this.formattedDbSchema || this.formattedDbSchema === 'No schema information available.') {
            this.logger.error('DB Schema is not available. Cannot generate query.');
            throw new Error('Database schema was not loaded successfully. Cannot proceed.');
        }

        const fullPrompt = this.makeQueryPromt(userQuestion);

        try {
            const result = await this.ai.models.generateContent({
                model: this.aiGeminiModel,
                contents: fullPrompt,
            });

            let generatedText: string | undefined = undefined;

            // Get the generated text from the response
            if (result &&
                result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content &&
                result.candidates[0].content.parts && result.candidates[0].content.parts.length > 0) {
                generatedText = result.candidates[0].content.parts[0].text;
                //this.logger.debug(`Extracted text from Gemini: ${generatedText}`);
            } else {
                this.logger.error('Unexpected Gemini response structure. Cannot extract text.', JSON.stringify(result?.candidates, null, 2));
                throw new InternalServerErrorException('Failed to parse Gemini response structure.');
                // throw new Error('Failed to parse Gemini response structure.');
            }


            // "generatedText" has the string of the response (or null if the extraction failed)
            if (!generatedText) {
                // This should not happen if the previous logic worked, but it's a double check
                throw new InternalServerErrorException('Extracted text from Gemini is null or empty.');
                //throw new Error('Extracted text from Gemini is null or empty.');
            }

            // Clean the generated text to extract the SQL query
            const cleanedQuery = this.extractSQL(generatedText);

            if (!cleanedQuery) {
                this.logger.warn(`Could not extract a valid SQL query from Gemini's response. Raw text: "${generatedText}"`);
                throw new InternalServerErrorException('Failed to extract a valid SQL query from Gemini response.');
                //throw new Error('Failed to extract a valid SQL query from Gemini response.');
            }


            if (this.isQuerySafe(cleanedQuery)) {
                return cleanedQuery;
            } else {
                this.logger.warn(`Generated query rejected due to forbidden keywords: ${cleanedQuery}`);
                throw new ForbiddenSqlOperationError();
            }

        } catch (error) {
            this.logger.error(`Error during Gemini interaction or processing: ${error.message}`, error.stack);
            if (error.response) { // If the errors comes from the API HTTP
                this.logger.error('Error response data:', error.response.data);
            }

            // Re send the error to the controller
            if (error instanceof ForbiddenSqlOperationError || error instanceof InternalServerErrorException) {
                throw error;
            }

            throw new InternalServerErrorException(`An unexpected error occurred while trying to get and process the SQL query from Gemini: ${error.message}`);
            // throw new Error(`Failed to get and process response from Gemini: ${error.message}`);
        }
    }

    /**
     * Generate the prompt for Gemini.
     * @param userQuestion 
     * @returns 
     */
    private makeQueryPromt(userQuestion: string): string {
        return `
            Contexto: Eres un asistente experto en SQL. Tu tarea es generar una consulta SQL robusta y completa basada en el schema de base de datos proporcionado y una pregunta del usuario. El objetivo es proporcionar la respuesta más útil y completa posible según los datos.
            Base de datos: PostgreSQL

            Schema de la Base de Datos:
            ---
            ${this.formattedDbSchema}
            ---

            Pregunta del Usuario: "${userQuestion}"

            Instrucciones Clave para Generar la Consulta:
            1.  Analiza cuidadosamente el schema y la pregunta del usuario.
            2.  **Genera la consulta SQL MÁS COMPLETA y ROBUSTA posible** que responda a la pregunta, utilizando las tablas y columnas disponibles. Tu objetivo es anticipar posibles ambigüedades o casos comunes en el análisis de datos.
            3.  **Manejo de Mínimos, Máximos y Empates:** Si la pregunta pide un mínimo, máximo, "top N", "bottom N", o similar (p. ej., "¿Quién vendió menos/más productos?"), la consulta DEBE devolver **TODOS** los registros que cumplan esa condición extrema, incluso si hay empates. No devuelvas solo un resultado arbitrario si varios comparten el valor mínimo/máximo. Por ejemplo, si varios usuarios vendieron la cantidad mínima de 3 productos y la pregunta es "¿Quién vendió menos?", la consulta debe devolver todos esos usuarios.
            4.  **Claridad sobre Agregaciones:** Si la pregunta implica una agregación (suma, promedio, conteo, mínimo, máximo) sobre grupos, asegúrate de que la consulta realice la agrupación correcta (usando "GROUP BY").
            5.  Utiliza la sintaxis correcta para PostgreSQL. Considera el uso de CTEs (Common Table Expressions) como "WITH" para mejorar la legibilidad y la lógica en consultas complejas si es apropiado.
            6.  **IMPORTANTE SOBRE IDENTIFICADORES:** En PostgreSQL, los identificadores (nombres de tablas y columnas) que no están entre comillas dobles se convierten a minúsculas. Para preservar la capitalización original (ej. 'userId', 'createdAt', 'NombreTabla'), **DEBES encerrar TODOS los nombres de tablas y columnas en comillas dobles en la consulta SQL generada.** Por ejemplo: \`SELECT s."userId", s."quantity" FROM "sales" s JOIN "users" u ON s."userId" = u."id";\` Aliases de tablas (como 's' o 'u' en el ejemplo) no necesitan comillas dobles si son simples y no contienen caracteres especiales o mayúsculas que quieras preservar.
            7.  **Devuelve SOLAMENTE la consulta SQL.** No incluyas explicaciones, comentarios, texto introductorio/final, ni bloques de código como \`\`\`sql ... \`\`\`. Solo el texto puro de la consulta SQL.

            Consulta SQL Generada:
            `;
    }


    /**
     * Extracts the SQL code from Gemini's response, removing possible
     * code blocks (```sql ... ```) or additional text.
     * @param rawResponse - The raw response from Gemini.
     * @returns The extracted SQL code or null if not found.
     */
    private extractSQL(rawResponse: string): string | null {
        if (!rawResponse) return null;

        // Case 1: Search for SQL code blocks delimited by ```sql ... ```
        const sqlBlockMatch = rawResponse.match(/```sql\s*([\s\S]*?)\s*```/i);
        if (sqlBlockMatch && sqlBlockMatch[1]) {
            return sqlBlockMatch[1].trim();
        }

        // Case 2: Search for generic code blocks ``` ... ```
        const genericBlockMatch = rawResponse.match(/```([\s\S]*?)```/);
        if (genericBlockMatch && genericBlockMatch[1]) {
            // Could be SQL, try to check if it looks like SQL (very basic)
            const potentialSQL = genericBlockMatch[1].trim();
            if (potentialSQL.toLowerCase().startsWith('select') || potentialSQL.toLowerCase().startsWith('with') || potentialSQL.toLowerCase().startsWith('update') || potentialSQL.toLowerCase().startsWith('insert') || potentialSQL.toLowerCase().startsWith('delete')) {
                return potentialSQL;
            }
        }

        // Case 3: Assume the response *is* the SQL query, but clean leading/trailing spaces/newlines.
        // Could add a heuristic: if it starts with SELECT, INSERT, UPDATE, DELETE, WITH...
        const trimmedResponse = rawResponse.trim();
        const sqlKeywords = ['select', 'insert', 'update', 'delete', 'with', 'create', 'alter', 'drop'];
        if (sqlKeywords.some(keyword => trimmedResponse.toLowerCase().startsWith(keyword))) {
            // Remove common introductory text if it exists (e.g., "Here is the SQL query:")
            const lines = trimmedResponse.split('\n');

            // Search for the first line that looks like SQL
            for (let i = 0; i < lines.length; i++) {
                const lineTrimmedLower = lines[i].trim().toLowerCase();
                if (sqlKeywords.some(keyword => lineTrimmedLower.startsWith(keyword))) {
                    return lines.slice(i).join('\n').trim(); // Devolver desde esa línea en adelante
                }
            }
            // If no clear starting line was found but the text starts with a keyword, return it as is
            return trimmedResponse;
        }

        // If nothing works, return null or the original text if you think it could be valid
        // Returns null to avoid executing unwanted text.
        return null;
    }


    /**
     * Checks if the provided SQL query is safe to execute (read-only).
     * @param query - The SQL query string.
     * @returns True if the query is considered safe, false otherwise.
     */
    private isQuerySafe(query: string): boolean {
        if (!query) return false;

        const queryUpper = query.toUpperCase();

        // Search ANY of the forbidden keywords in ANY PLACE of the query.
        // this is more secure than just searching at the beginning, as they could be in subqueries or malicious CTEs.
        // Consider using regular expressions to search for complete words (\bkeyword\b) if you need more precision
        // and avoid false positives (e.g., a column named 'status_update').
        // Simple regex to search for complete words:
        for (const keyword of this.forbiddenSqlKeywords) {
            // \b secure that it is a complete word, not part of another (e.g: 'updates' vs 'update')
            // The flag 'g' is not necessary as we are only checking for existence.
            const regex = new RegExp(`\\b${keyword}\\b`);
            if (regex.test(queryUpper)) {
                this.logger.warn(`Forbidden keyword "${keyword}" detected in query.`);
                return false; // gets a forbidden keyword, so it's not safe
            }
        }

        // Opcional: añadir una validación POSITIVA
        // Optional: you could add a POSITIVE validation to check for SELECT or WITH at the beginning
        // const trimmedQuery = query.trim().toUpperCase();
        // if (!trimmedQuery.startsWith('SELECT') && !trimmedQuery.startsWith('WITH')) {
        //     this.logger.warn(`Query does not start with SELECT or WITH.`);
        //     return false;
        // }

        return true; // If no forbidden keywords were found, it's safe
    }

}
