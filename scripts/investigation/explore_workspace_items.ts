import Database from 'better-sqlite3';
import { existsSync, readdirSync } from 'node:fs';
import { platform } from 'node:os';
import { join } from 'node:path';

// --- Re-used function ---
function getWorkspaceStoragePath(): null | string {
    const os = platform();
    const home = process.env.HOME || process.env.USERPROFILE || '';
    if (!home) return null;

    let basePath: string;
    switch (os) {
        case 'darwin': {
            basePath = join(home, 'Library/Application Support/Cursor');
            break;
        }

        case 'linux': {
            basePath = join(home, '.config/Cursor');
            break;
        }

        case 'win32': {
            basePath = join(process.env.APPDATA || join(home, 'AppData/Roaming'), 'Cursor');
            break;
        }

        default: {
            return null;
        }
    }

    return join(basePath, 'User/workspaceStorage');
}
// --- END Re-used function ---

// Helper function to analyze composer data (similar to analyzeMessage)
function analyzeComposerData(data: any, indent: string) {
    if (typeof data !== 'object' || data === null) {
        console.log(`${indent}Data is not an object.`);
        return;
    }

    console.log(`${indent}Top-level keys:`, Object.keys(data));

    // Specific checks based on your current code (extract-conversations.ts uses this for mapping)
    console.log(`${indent}Has 'allComposers': ${'allComposers' in data} (is Array: ${Array.isArray(data.allComposers)})`);

    if (Array.isArray(data.allComposers) && data.allComposers.length > 0) {
        const firstComposer = data.allComposers[0];
        console.log(`\n${indent}First Composer Sample:`);
        if (typeof firstComposer === 'object' && firstComposer !== null) {
            console.log(`${indent}  Top-level keys:`, Object.keys(firstComposer));
            console.log(`${indent}  Has 'composerId': ${'composerId' in firstComposer} (type: ${typeof firstComposer.composerId})`);
            console.log(`${indent}  Has 'historyKey': ${'historyKey' in firstComposer} (type: ${typeof firstComposer.historyKey})`); // Check for potential new key reference
            // Add checks for other fields you expect within each composer entry if needed
        } else {
            console.log(`${indent}  First composer item is not an object.`);
        }
    } else {
        console.log(`${indent}allComposers array is empty or not found.`);
    }
}

async function main() {
    const workspaceStoragePath = getWorkspaceStoragePath();
    if (!workspaceStoragePath || !existsSync(workspaceStoragePath)) {
        console.log('Workspace storage path not found or inaccessible.');
        throw new Error('Workspace storage path not found or inaccessible.');
    }

    let firstWorkspaceDbPath: null | string = null;
    try {
        console.log("Scanning workspace storage directory...");
        const workspaceDirs = readdirSync(workspaceStoragePath, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory() && !dirent.name.startsWith('.')) // Exclude hidden
            .map(dirent => dirent.name);
        console.log(`Found ${workspaceDirs.length} non-hidden workspace directories.`);

        if (workspaceDirs.length > 0) {
            const firstWorkspaceId = workspaceDirs[0];
            firstWorkspaceDbPath = join(workspaceStoragePath, firstWorkspaceId, 'state.vscdb'); // Assume old name first
            if (!existsSync(firstWorkspaceDbPath)) {
                console.log(`Workspace DB ${firstWorkspaceDbPath} not found, trying storage.db`);
                firstWorkspaceDbPath = join(workspaceStoragePath, firstWorkspaceId, 'storage.db'); // Try new name
            }
        } else {
            console.log("No non-hidden workspace directories found.");
        }
    } catch (error) {
        console.error("Error accessing workspace storage:", error);
        throw error;
    }

    if (!firstWorkspaceDbPath || !existsSync(firstWorkspaceDbPath)) {
        console.log('Could not find or access a sample workspace database (tried state.vscdb and storage.db).');
        throw new Error('Could not find or access a sample workspace database.');
    }

    console.log(`--- Inspecting Workspace DB: ${firstWorkspaceDbPath} ---`);
    let db: Database.Database | null = null;
    try {
        console.log("Attempting to connect to DB...");
        db = new Database(firstWorkspaceDbPath, { fileMustExist: true, readonly: true });
        console.log("DB Connected.");

        // Fetch the composer.composerData entry from ItemTable
        const targetKey = 'composer.composerData';
        console.log(`Attempting to fetch key '${targetKey}' from ItemTable...`);
        let row: undefined | { key: string; value: Buffer };
        try {
            row = db.prepare("SELECT key, value FROM ItemTable WHERE key = ?").get(targetKey) as undefined | { key: string; value: Buffer };
        } catch (dbError) {
            console.error(`Error fetching key '${targetKey}' from ItemTable:`, dbError);
            throw dbError;
        }

        if (!row) {
            console.log(`Row with key '${targetKey}' not found in ItemTable.`);
            // Optional: List other keys if needed
            try {
                const otherKeys = db.prepare("SELECT key FROM ItemTable LIMIT 10").all();
                console.log("Sample keys in ItemTable:", otherKeys.map((r: any) => r.key));
            } catch (listError) {
                console.error("Error fetching sample keys from ItemTable:", listError);
            }

            return; // Exit main function gracefully if key not found
        }

        console.log(`--- Analyzing Row (Key: ${row.key}) ---`);
        let rawValue: string | undefined;
        try {
            if (!row.value) {
                console.log("  Value is null or undefined.");
                return;
            }

            console.log(`  Attempting to convert buffer (length: ${row.value.length}) to string...`);
            rawValue = row.value.toString('utf8');
            console.log("  Buffer converted. Attempting to parse JSON...");
            const data = JSON.parse(rawValue);
            console.log("  JSON Parsed successfully.");

            analyzeComposerData(data, "  "); // Use the helper

            const truncatedValue = rawValue.slice(0, 500);
            const suffix = rawValue.length > 500 ? '...' : '';
            console.log(`\n  Raw Value (truncated): ${truncatedValue}${suffix}`);

        } catch (error) {
            console.error(`Error processing row for key ${row.key}:`, error);
            if (error instanceof SyntaxError) {
                console.log('  Potentially malformed JSON.');
            }

            const rawSlice = rawValue?.slice(0, 500) ?? '';
            const rawSuffix = rawValue && rawValue.length > 500 ? '...' : '';
            console.log(`\n  Raw Value (Buffer as string, if available): ${rawSlice}${rawSuffix}`);
        }

        console.log(`--- End Row Analysis ---`);

    } catch (error) {
        console.error("An error occurred during main execution:", error);
        throw error; // Re-throw
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

// Call async main and catch errors
main().catch(finalError => {
    console.error("Script finished with an error:", finalError);
    process.exitCode = 1; // Set exit code for failure
}); 