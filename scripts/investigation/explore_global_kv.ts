import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import os, { platform } from 'node:os';
import path, { join } from 'node:path';
import { inspect } from 'node:util'; // Import inspect
import { readdirSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

// Configuration
const targetKeys = [
    // Composer data keys (from previous logs)
    'composerData:abbec97c-2837-4069-9c0b-52d3805ef17d',
    'composerData:4e5f9beb-8c69-491a-9fd6-9a098cf9274c',
    'composerData:dfd33dba-fd48-4ccb-bc2f-4f5fc80e7c8b',
    'composerData:ab1cbc76-469b-4285-9676-5fdd7d641469',
    // Potential Bubble Data Key (using the first bubbleId from the first composer)
    'bubbleData:36e8d615-9da4-421e-8645-0dceeb0afc03',
    // Other potential bubble key formats (guesses)
    'message:36e8d615-9da4-421e-8645-0dceeb0afc03',
    'bubble:36e8d615-9da4-421e-8645-0dceeb0afc03',
];

const dbPath = path.join(
    os.homedir(),
    'Library/Application Support/Cursor/User/globalStorage/state.vscdb',
);

// --- Script Logic ---

function getDatabasePath(): string {
    const platform = os.platform();
    let dbPathBase = '';

    switch (platform) {
        case 'darwin': {
            dbPathBase = path.join(
                os.homedir(),
                'Library/Application Support/Cursor/User',
            );
            break;
        }

        case 'linux': {
            dbPathBase = path.join(os.homedir(), '.config/Cursor/User');
            break;
        }

        case 'win32': {
            dbPathBase = path.join(process.env.APPDATA || '', 'Cursor/User');
            break;
        }

        default: {
            throw new Error(`Unsupported platform: ${platform}`);
        }
    }

    if (!dbPathBase) {
        throw new Error('Could not determine database path base.');
    }

    return path.join(dbPathBase, 'globalStorage/state.vscdb');
}

function exploreDatabase(targetKeys: string[]) {
    const resolvedDbPath = getDatabasePath();
    console.log(`Attempting to connect to database at: ${resolvedDbPath}`);

    let db;
    try {
        db = new Database(resolvedDbPath, { fileMustExist: true, readonly: true });
        console.log('Successfully connected to the database.');

        console.log('\n--- Exploring Specific Keys ---');
        const stmt = db.prepare('SELECT value FROM ItemTable WHERE key = ?');

        for (const key of targetKeys) {
            console.log(`\n[Querying Key] ${key}`); // Log the key being queried
            try {
                const row = stmt.get(key) as undefined | { value: string };

                if (row) {
                    console.log(`  [Found Key] ${key}`);
                    try {
                        const parsedValue = JSON.parse(row.value);
                        console.log(
                            `  [Parsed Value] First level keys: ${Object.keys(parsedValue).join(', ')}`,
                        );
                        // Log the full parsed JSON for detailed inspection
                        console.log(
                            `  [Full Parsed Value for ${key}]:\n${inspect(parsedValue, { colors: true, depth: null })}`,
                        );
                    } catch (parseError) {
                        console.error(`  [Error Parsing JSON for key ${key}]:`, parseError);
                        console.log(`  [Raw Value] ${row.value.slice(0, 200)}...`);
                    }
                } else {
                    console.log(`  [Key Not Found] ${key}`);
                }
            } catch (error) {
                console.error(`  [Error Querying Key ${key}]:`, error);
            }
        }

        // Optional: Explore key structure around bubble IDs if needed
        console.log('\n--- Exploring Potential Bubble Key Structures ---');
        const bubblePrefixStmt = db.prepare(
            "SELECT key FROM ItemTable WHERE key LIKE 'bubbleData:%' OR key LIKE 'message:%' OR key LIKE 'bubble:%' LIMIT 10",
        );
        try {
            const bubbleKeys = bubblePrefixStmt.all() as { key: string }[];
            if (bubbleKeys.length > 0) {
                console.log('Found potential bubble keys:');
                for (const k of bubbleKeys) console.log(`  - ${k.key}`);
            } else {
                console.log('No keys found matching bubbleData:%, message:%, or bubble:%');
            }
        } catch (error) {
            console.error('Error searching for bubble key prefixes:', error);
        }
    } catch (error) {
        console.error('Failed to connect to or query the database:', error);
    } finally {
        if (db) {
            db.close();
            console.log('\nDatabase connection closed.');
        }
    }
}

// --- Main Execution ---
console.log('Starting database exploration...');
exploreDatabase(targetKeys);
console.log('Exploration finished.');

// Helper function to search for path within nested objects/arrays
function findPathInObject(obj: any, path: string, currentPath: string = ''): string[] {
    const foundPaths: string[] = [];
    if (obj === null || typeof obj !== 'object') {
        return foundPaths;
    }

    for (const key in obj) {
        if (Object.hasOwn(obj, key)) {
            const value = obj[key];
            const newPath = currentPath ? `${currentPath}.${key}` : key;

            if (typeof value === 'string' && value.includes(path)) {
                foundPaths.push(newPath);
            }

            if (typeof value === 'object') {
                foundPaths.push(...findPathInObject(value, path, newPath));
            }
        }
    }

    return foundPaths;
}

async function main() { // Wrap in async function
    const globalDbPath = getDatabasePath();
    if (!globalDbPath || !existsSync(globalDbPath)) {
        console.log('Global database not found.');
        throw new Error("Global database not found.");
    }

    console.log(`--- Inspecting Global DB: ${globalDbPath} ---`);
    let db: Database.Database | null = null;
    const targetPath = '/Users/johnlindquist/workshop-demos';

    try {
        console.log("Attempting to connect to DB...");
        db = new Database(globalDbPath, { fileMustExist: true, readonly: true });
        console.log("DB Connected.");

        console.log("Fetching specific keys and analyzing JSON structure...");
        const stmt = db.prepare("SELECT key, value FROM cursorDiskKV WHERE key = ?");

        for (const key of targetKeys) {
            console.log(`\n--- Analyzing Row (Key: ${key}) ---`);
            const row = stmt.get(key) as undefined | { key: string; value: Buffer };
            if (row && row.value) {
                let rawValue: string | undefined;
                try {
                    rawValue = row.value.toString('utf8');
                    // Try parsing JSON
                    try {
                        const data = JSON.parse(rawValue);
                        console.log("  JSON Parsed successfully.");
                        // Log the full parsed JSON structure
                        console.log("  Full Parsed JSON Data:");
                        console.log(inspect(data, { colors: true, depth: null })); // Log entire object

                        // Search for the path within the parsed JSON structure
                        const locations = findPathInObject(data, targetPath);

                        if (locations.length > 0) {
                            console.log(`  Target path "${targetPath}" found in the following JSON locations:`);
                            for (const loc of locations) console.log(`    - ${loc}`);
                            // Optionally log snippets of the data at these locations
                            // locations.forEach(loc => {
                            //   try {
                            //     const keys = loc.split('.');
                            //     let val = data;
                            //     keys.forEach(k => { val = val[k]; });
                            //     console.log(`      Snippet at ${loc}: ${inspect(val, { depth: 1, colors: true }).slice(0, 200)}...`);
                            //   } catch { /* ignore errors getting snippet */ }
                            // });
                        } else {
                            console.log(`  WARNING: Target path "${targetPath}" NOT found within the parsed JSON structure.`);
                        }

                    } catch (jsonError) {
                        console.error("  Error parsing JSON:", jsonError);
                        console.log("  Value (UTF8 Decoded, first 500 chars):");
                        console.log(rawValue.slice(0, 500) + (rawValue.length > 500 ? '...' : ''));
                    }

                } catch (decodeError) {
                    console.error("  Error decoding buffer:", decodeError);
                }
            } else {
                console.log("  Row not found or value is null.");
            }

            console.log(`--- End Row (Key: ${key}) ---\n`);
        }

    } catch (error) {
        console.error("An error occurred during main execution:", error);
        throw error;
    } finally {
        if (db) {
            console.log("Closing DB connection...");
            db.close();
            console.log("DB Closed.");
        } else {
            console.log("DB connection was not established or already closed.");
        }
    }
}

// Helper function to process rows (No longer used in this version)
// function processRows(rows: { key: string; value: Buffer }[]) { ... }

// Updated Helper function to analyze the structure within a conversation item (Keep for potential future use)
// function analyzeConversationItem(item: any, indent: string) { ... }

// NEW Helper function to analyze the parsed richText data (Keep for potential future use)
// function analyzeRichTextData(data: any, indent: string) { ... }

// Call async main and catch errors
main().catch(finalError => {
    console.error("Script finished with an error:", finalError);
    process.exitCode = 1;
});

// --- Diagnostic: Print context and fileSelections for all composerData entries for a workspace ---

function getWorkspaceStoragePath(): string {
    const os = platform();
    const home = os.homedir();
    switch (os.platform()) {
        case 'darwin':
            return join(home, 'Library/Application Support/Cursor/User/workspaceStorage');
        case 'linux':
            return join(home, '.config/Cursor/User/workspaceStorage');
        case 'win32':
            return join(process.env.APPDATA || join(home, 'AppData/Roaming'), 'Cursor/User/workspaceStorage');
        default:
            throw new Error(`Unsupported platform: ${os}`);
    }
}

function decodeWorkspacePath(uri: string): string {
    try {
        const path = uri.replace(/^file:\/\//, '');
        return decodeURIComponent(path);
    } catch (error) {
        console.error('Failed to decode workspace path:', error);
        return uri;
    }
}

function getWorkspaceComposerIds(workspaceName: string): Set<string> {
    const composerIds = new Set<string>();
    const workspaceStoragePath = getWorkspaceStoragePath();
    const nameLower = workspaceName.toLowerCase();
    try {
        const workspaces = readdirSync(workspaceStoragePath, { withFileTypes: true });
        for (const workspace of workspaces) {
            if (!workspace.isDirectory()) continue;
            const workspaceJsonPath = join(workspaceStoragePath, workspace.name, 'workspace.json');
            if (!existsSync(workspaceJsonPath)) continue;
            let workspacePath = '';
            let currentWorkspaceName = '';
            try {
                const workspaceData = JSON.parse(readFileSync(workspaceJsonPath, 'utf8'));
                if (workspaceData.folder) {
                    workspacePath = decodeWorkspacePath(workspaceData.folder);
                    currentWorkspaceName = basename(workspacePath);
                } else {
                    continue;
                }
            } catch {
                continue;
            }
            if (currentWorkspaceName.toLowerCase() !== nameLower && !workspacePath.toLowerCase().includes(nameLower)) {
                continue;
            }
            const dbPath = join(workspaceStoragePath, workspace.name, 'state.vscdb');
            if (!existsSync(dbPath)) continue;
            let db: Database.Database | null = null;
            try {
                db = new Database(dbPath, { fileMustExist: true, readonly: true });
                const result = db.prepare("SELECT value FROM ItemTable WHERE key = 'composer.composerData'").get() as undefined | { value: string };
                if (result?.value) {
                    const parsed = JSON.parse(result.value);
                    if (typeof parsed === 'object' && parsed !== null && 'allComposers' in parsed && Array.isArray(parsed.allComposers)) {
                        for (const composer of parsed.allComposers) {
                            if (typeof composer === 'object' && composer !== null && 'composerId' in composer && typeof composer.composerId === 'string') {
                                composerIds.add(composer.composerId);
                            }
                        }
                    }
                }
            } catch {
            } finally {
                db?.close();
            }
        }
    } catch { }
    return composerIds;
}

function printComposerContextsForWorkspace(workspaceName: string) {
    const composerIds = getWorkspaceComposerIds(workspaceName);
    if (composerIds.size === 0) {
        console.log(`[DIAG] No composer IDs found for workspace: ${workspaceName}`);
        return;
    }
    const dbPath = getDatabasePath();
    let db: Database.Database | null = null;
    try {
        db = new Database(dbPath, { fileMustExist: true, readonly: true });
        const stmt = db.prepare('SELECT key, value FROM cursorDiskKV WHERE key = ?');
        for (const id of composerIds) {
            const key = `composerData:${id}`;
            const row = stmt.get(key) as undefined | { key: string; value: Buffer };
            if (row && row.value) {
                let rawValue: string | undefined;
                try {
                    rawValue = row.value.toString('utf8');
                    const data = JSON.parse(rawValue);
                    console.log(`\n[DIAG] composerId: ${id}`);
                    if ('context' in data) {
                        console.log(`[DIAG]   context: ${inspect(data.context, { depth: 3 })}`);
                    } else {
                        console.log(`[DIAG]   context: <none>`);
                    }
                    if ('fileSelections' in data) {
                        console.log(`[DIAG]   fileSelections: ${inspect(data.fileSelections, { depth: 3 })}`);
                    } else {
                        console.log(`[DIAG]   fileSelections: <none>`);
                    }
                    if ('conversation' in data && Array.isArray(data.conversation)) {
                        console.log(`[DIAG]   conversation.length: ${data.conversation.length}`);
                    } else {
                        console.log(`[DIAG]   conversation: <none>`);
                    }
                } catch (err) {
                    console.log(`[DIAG]   Error parsing composerData for ${id}:`, err);
                }
            } else {
                console.log(`[DIAG] composerData not found in global DB for composerId: ${id}`);
            }
        }
    } catch (err) {
        console.log(`[DIAG] Error opening global DB:`, err);
    } finally {
        db?.close();
    }
}

// --- Main Diagnostic Execution ---
if (process.argv.includes('--diagnose-workspace')) {
    const idx = process.argv.indexOf('--diagnose-workspace');
    const workspaceName = process.argv[idx + 1];
    if (!workspaceName) {
        console.error('Usage: pnpm tsx scripts/investigation/explore_global_kv.ts --diagnose-workspace <workspaceName>');
        process.exit(1);
    }
    printComposerContextsForWorkspace(workspaceName);
    process.exit(0);
} 