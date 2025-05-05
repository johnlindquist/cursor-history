import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { inspect } from 'node:util';

// Helper to parse JSON safely
function safeJsonParse(value: Buffer | null | string | undefined): any {
    if (value === null || value === undefined) return null;
    try {
        // Ensure value is a string before parsing
        const stringValue = Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
        // Basic check for likely JSON
        if (stringValue.trim().startsWith('{') || stringValue.trim().startsWith('[')) {
            return JSON.parse(stringValue);
        }
    } catch { /* Ignore parsing errors */ }

    return null;
}

// Helper to check if a value might be interesting (contains keywords)
function mightBeInteresting(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    const lowerString = String(value).toLowerCase();
    const keywords = ['conversation', 'message', 'chat', 'prompt', 'response', 'composer', 'bubble', 'history'];
    return keywords.some(kw => lowerString.includes(kw));
}

async function main() {
    const dbPath = process.argv[2];
    if (!dbPath) {
        console.error('Error: Please provide the full path to the database file as an argument.');
        console.log('Example: pnpm tsx scripts/investigation/reinspect_database.ts /path/to/database.db');
        throw new Error('Database path argument is required.');
    }

    if (!existsSync(dbPath)) {
        console.error(`Error: Database file not found at: ${dbPath}`);
        throw new Error(`Database file not found at: ${dbPath}`);
    }

    console.log(`--- Re-inspecting Database: ${dbPath} ---`);
    let db: Database.Database | null = null;
    const SAMPLE_SIZE = 5; // Number of rows to sample per table

    try {
        db = new Database(dbPath, { fileMustExist: true, readonly: true });
        console.log("DB Connected.");

        // 1. List all tables
        console.log("\n--- Tables ---");
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
        if (tables.length === 0) {
            console.log("No user tables found in the database.");
            return;
        }

        console.log(`Found ${tables.length} tables: ${tables.map(t => t.name).join(', ')}`);

        // 2. Inspect each table
        for (const table of tables) {
            console.log(`\n--- Inspecting Table: ${table.name} (Sampling ${SAMPLE_SIZE} rows) ---`);
            let columnNames: string[] = [];
            try {
                // Get schema
                const pragma = db.prepare(`PRAGMA table_info(${table.name})`).all() as { name: string; type: string }[];
                columnNames = pragma.map(col => col.name);
                const schema = pragma.map(col => `${col.name} (${col.type})`).join(', ');
                console.log(`  Schema: ${schema}`);

                // Get sample rows
                const rows = db.prepare(`SELECT * FROM ${table.name} LIMIT ${SAMPLE_SIZE}`).all() as any[];
                if (rows.length === 0) {
                    console.log("  Table is empty or no rows retrieved.");
                    continue;
                }

                console.log(`  --- Sample Rows ---`);
                let rowIndex = 0;
                for (const row of rows) {
                    rowIndex++;
                    console.log(`    --- Row ${rowIndex} ---`);
                    for (const colName of columnNames) {
                        const value = row[colName];
                        let output = `      ${colName}: `;
                        let isInteresting = false;
                        let parsedData: any = null;

                        // Try parsing if it looks like JSON or is a BLOB
                        if (Buffer.isBuffer(value) || (typeof value === 'string' && (value.trim().startsWith('{') || value.trim().startsWith('[')))) {
                            parsedData = safeJsonParse(value);
                        }

                        // Format output
                        if (parsedData !== null) {
                            output += `[ Parsed JSON - Keys: ${Object.keys(parsedData).slice(0, 5).join(', ')}${Object.keys(parsedData).length > 5 ? '...' : ''} ]`;
                            isInteresting = mightBeInteresting(JSON.stringify(parsedData));
                        } else if (Buffer.isBuffer(value)) {
                            const preview = value.toString('utf8', 0, 100); // Preview as UTF-8
                            output += `[ BLOB - Length: ${value.length}, Preview: ${preview.replaceAll(/\r?\n/g, ' ')}${value.length > 100 ? '...' : ''} ]`;
                            isInteresting = mightBeInteresting(preview);
                        } else {
                            const strValue = String(value);
                            output += `${strValue.slice(0, 100).replaceAll(/\r?\n/g, ' ')}${strValue.length > 100 ? '...' : ''}`;
                            isInteresting = mightBeInteresting(strValue);
                        }

                        console.log(output);
                        // Add extra log if the content seems interesting based on keywords
                        if (isInteresting && parsedData === null) {
                            console.log(`        -> Contains potential keywords.`);
                        }
                    }
                }
            } catch (tableError) {
                console.error(`    Error inspecting table ${table.name}:`, tableError);
            }
        }

        console.log("\n--- Re-inspection Complete ---");

    } catch (error) {
        console.error("\nAn error occurred during database inspection:", error);
    } finally {
        if (db) {
            console.log("\nClosing DB connection...");
            db.close();
            console.log("DB Closed.");
        }
    }
}

try {
    await main();
} catch (error) {
    console.error("Unhandled error during script execution:", error);
    process.exitCode = 1;
} 