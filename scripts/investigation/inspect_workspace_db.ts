import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { inspect } from 'node:util';

// Helper to analyze data structure (similar to other scripts)
function analyzeDataStructure(data: any, description: string, indent: string) {
    console.log(`${indent}--- Analyzing Data: ${description} ---`);
    if (typeof data !== 'object' || data === null) {
        console.log(`${indent}Data is not an object or is null.`);
        return;
    }

    console.log(`${indent}Top-level keys: ${Object.keys(data).join(', ')}`);
    console.log(`${indent}Has 'composerId': ${'composerId' in data} (type: ${typeof (data as any).composerId})`);
    console.log(`${indent}Has 'conversation': ${'conversation' in data} (isArray: ${Array.isArray((data as any).conversation)}, length: ${Array.isArray((data as any).conversation) ? (data as any).conversation.length : 'N/A'})`);
    console.log(`${indent}Has 'messages': ${'messages' in data} (isArray: ${Array.isArray((data as any).messages)}, length: ${Array.isArray((data as any).messages) ? (data as any).messages.length : 'N/A'})`); // Check for 'messages' too
    console.log(`${indent}------------------------------------`);
}

// Helper to parse JSON safely
function safeJsonParse(value: Buffer | null | string | undefined): any {
    if (value === null || value === undefined) return null;
    try {
        const stringValue = typeof value === 'string' ? value : value.toString('utf8');
        return JSON.parse(stringValue);
    } catch {
        return null; // Return null if parsing fails
    }
}

async function main() {
    const dbPath = process.argv[2];
    if (!dbPath) {
        console.error('Error: Please provide the full path to the state.vscdb file as an argument.');
        console.log('Example: pnpm tsx scripts/investigation/inspect_workspace_db.ts /path/to/state.vscdb');
        process.exit(1);
    }

    if (!existsSync(dbPath)) {
        console.error(`Error: Database file not found at: ${dbPath}`);
        process.exit(1);
    }

    console.log(`--- Inspecting Database: ${dbPath} ---`);
    let db: Database.Database | null = null;

    try {
        db = new Database(dbPath, { fileMustExist: true, readonly: true });
        console.log("DB Connected.");

        // 1. List all tables and their schemas
        console.log("\n--- Tables and Schemas ---");
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
        if (tables.length === 0) {
            console.log("No tables found in the database.");
        } else {
            console.log(`Found ${tables.length} tables: ${tables.map(t => t.name).join(', ')}`);
            for (const table of tables) {
                try {
                    const pragma = db.prepare(`PRAGMA table_info(${table.name})`).all();
                    const schema = pragma.map((col: any) => `${col.name} (${col.type})`).join(', ');
                    console.log(`  - ${table.name}: ${schema}`);
                } catch (pragmaError) {
                    console.error(`    Error getting schema for table ${table.name}:`, pragmaError);
                }
            }
        }

        // 2. Inspect ItemTable for relevant keys
        console.log("\n--- Inspecting ItemTable (Searching for specific + keyword keys) ---");
        try {
            const itemTableExists = tables.some(t => t.name === 'ItemTable');
            if (itemTableExists) {
                // Explicitly check the key found in the Python script
                const specificKeyToCheck = 'workbench.panel.aichat.view.aichat.chatdata';
                console.log(`\nChecking specific key: ${specificKeyToCheck}`);
                const specificStmt = db.prepare("SELECT key, value FROM ItemTable WHERE key = ?");
                const specificRow = specificStmt.get(specificKeyToCheck) as { key: string; value: string } | undefined;
                if (specificRow?.value) {
                    console.log(`  Found specific key: ${specificRow.key}`);
                    const data = safeJsonParse(specificRow.value);
                    if (data) {
                        analyzeDataStructure(data, `Parsed JSON for ${specificRow.key}`, "    ");
                    } else {
                        console.log(`    Value is not valid JSON or empty.`);
                    }
                    console.log(`    Raw Value (first 200 chars): ${specificRow.value?.slice(0, 200)}${specificRow.value && specificRow.value.length > 200 ? '...' : ''}`);
                } else {
                    console.log(`  Specific key ${specificKeyToCheck} not found.`);
                }

                // Continue with keyword search for broader context
                console.log("\nChecking keyword-based keys ('conversation', 'composer', 'history', 'chat')...");
                const searchTerms = ['%conversation%', '%composer%', '%history%', '%chat%'];
                const stmt = db.prepare("SELECT key, value FROM ItemTable WHERE key LIKE ? AND key != ? LIMIT 3"); // Exclude specific key
                let foundAnyKeyword = false;
                for (const term of searchTerms) {
                    // Exclude the specific key already checked
                    const rows = stmt.all(term, specificKeyToCheck) as { key: string; value: string }[];
                    if (rows.length > 0) {
                        foundAnyKeyword = true;
                        console.log(`\nFound rows in ItemTable matching key LIKE '${term}':`);
                        for (const row of rows) {
                            console.log(`  Key: ${row.key}`);
                            const data = safeJsonParse(row.value);
                            if (data) {
                                analyzeDataStructure(data, `Parsed JSON for ${row.key}`, "    ");
                            } else {
                                console.log(`    Value is not valid JSON or empty.`);
                            }

                            console.log(`    Raw Value (first 200 chars): ${row.value?.slice(0, 200)}${row.value && row.value.length > 200 ? '...' : ''}`);
                        }
                    }
                }
                if (!foundAnyKeyword) {
                    console.log("No additional rows found matching the search terms in ItemTable.");
                }
            } else {
                console.log("Table 'ItemTable' not found.");
            }
        } catch (dbError) {
            console.error("Error querying ItemTable:", dbError);
        }

        // 3. Inspect cursorDiskKV for relevant keys (if it exists)
        console.log("\n--- Inspecting cursorDiskKV (Searching for keys containing 'conversation', 'composer', 'history', 'chat') ---");
        try {
            const kvTableExists = tables.some(t => t.name === 'cursorDiskKV');
            if (kvTableExists) {
                const searchTerms = ['%conversation%', '%composer%', '%history%', '%chat%'];
                const stmt = db.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE ? LIMIT 3"); // Limit results per term
                let foundAny = false;
                for (const term of searchTerms) {
                    const rows = stmt.all(term) as { key: string; value: Buffer }[];
                    if (rows.length > 0) {
                        foundAny = true;
                        console.log(`\nFound rows in cursorDiskKV matching key LIKE '${term}':`);
                        for (const row of rows) {
                            console.log(`  Key: ${row.key}`);
                            const data = safeJsonParse(row.value);
                            if (data) {
                                analyzeDataStructure(data, `Parsed JSON for ${row.key}`, "    ");
                            } else {
                                console.log(`    Value is not valid JSON or empty.`);
                            }

                            const rawString = row.value?.toString('utf8');
                            console.log(`    Raw Value (first 200 chars): ${rawString?.slice(0, 200)}${rawString && rawString.length > 200 ? '...' : ''}`);
                        }
                    }
                }

                if (!foundAny) {
                    console.log("No rows found matching the search terms in cursorDiskKV.");
                }
            } else {
                console.log("Table 'cursorDiskKV' not found.");
            }
        } catch (dbError) {
            console.error("Error querying cursorDiskKV:", dbError);
        }

        console.log("\n--- Inspection Complete ---");

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

main().catch(error => {
    console.error("Unhandled error in main execution:", error);
    process.exitCode = 1;
}); 