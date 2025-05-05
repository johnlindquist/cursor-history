import Database from 'better-sqlite3';
import { Dirent, existsSync, readdirSync, readFileSync } from 'node:fs';
import { platform } from 'node:os';
import { basename, join, resolve as pathResolve } from 'node:path';
import { inspect } from 'node:util';

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

// --- Added function from extract-conversations.ts ---
function decodeWorkspacePath(uri: string): string {
    try {
        // Handle file:// scheme and also potential windows paths starting with /c:/
        let path = uri.replace(/^file:\/\//, '');
        if (/^\/[a-zA-Z]:\//.test(path)) { // Check for Windows path like /c:/Users/...
            path = path.slice(1); // Remove the leading slash
        } // Corrected IF brace placement

        return decodeURIComponent(path);
    } catch (error) {
        console.error('Failed to decode workspace path:', error);
        return uri;
    } // This brace closes try/catch
} // This brace closes the function
// --- END Added function ---

// --- Helper function to analyze composer data (modified for brevity) ---
function analyzeDataStructure(data: any, description: string, indent: string) {
    console.log(`${indent}--- Analyzing Data: ${description} ---`);
    if (typeof data !== 'object' || data === null) {
        console.log(`${indent}Data is not an object or is null.`);
        return;
    }

    console.log(`${indent}Top-level keys:`, Object.keys(data));
    console.log(`${indent}Has 'composerId': ${'composerId' in data} (type: ${typeof (data as any).composerId})`);
    console.log(`${indent}Has 'conversation': ${'conversation' in data} (isArray: ${Array.isArray((data as any).conversation)}, length: ${Array.isArray((data as any).conversation) ? (data as any).conversation.length : 'N/A'})`);
    console.log(`${indent}Has 'allComposers': ${'allComposers' in data} (isArray: ${Array.isArray((data as any).allComposers)}, length: ${Array.isArray((data as any).allComposers) ? (data as any).allComposers.length : 'N/A'})`);
    console.log(`${indent}Other notable keys found:`);
    for (const key of Object.keys(data)) {
        if (!['allComposers', 'composerId', 'conversation'].includes(key)) {
            console.log(`${indent}  - ${key}`);
        }
    }

    console.log(`${indent}------------------------------------`);
}

async function main() {
    // --- MODIFIED: Get target workspace NAME from command line ---
    const targetWorkspaceName = process.argv[2];
    if (!targetWorkspaceName) {
        console.error('Error: Please provide the target workspace NAME as a command-line argument.');
        console.log('Example: pnpm tsx scripts/investigation/explore_workspace_items.ts my-workspace-name');
        process.exit(1);
    }

    console.log(`Searching for workspace matching name: "${targetWorkspaceName}"`);
    // --- END MODIFICATION ---

    const workspaceStoragePath = getWorkspaceStoragePath();
    if (!workspaceStoragePath || !existsSync(workspaceStoragePath)) {
        console.log('Workspace storage path not found or inaccessible.');
        throw new Error('Workspace storage path not found or inaccessible.');
    }

    // --- MODIFIED: Iterate and find matching workspace NAME ---
    let foundMatch = false;
    let targetDbPath: null | string = null;
    let targetWorkspaceId: null | string = null;

    try {
        console.log(`Scanning workspace storage directory: ${workspaceStoragePath}`);
        const workspaceDirs: Dirent[] = readdirSync(workspaceStoragePath, { withFileTypes: true });
        console.log(`Found ${workspaceDirs.length} total entries in workspace storage.`);

        for (const dirent of workspaceDirs) {
            if (!dirent.isDirectory() || dirent.name.startsWith('.')) {
                continue;
            }

            const workspaceId = dirent.name;
            const currentWorkspaceDirPath = join(workspaceStoragePath, workspaceId);
            const workspaceJsonPath = join(currentWorkspaceDirPath, 'workspace.json');
            const dbPath = join(currentWorkspaceDirPath, 'state.vscdb'); // Potential DB path

            if (!existsSync(workspaceJsonPath) || !existsSync(dbPath)) {
                continue;
            }

            try {
                const workspaceJsonContent = readFileSync(workspaceJsonPath, 'utf8');
                const workspaceData = JSON.parse(workspaceJsonContent);

                if (workspaceData && typeof workspaceData === 'object' && workspaceData.folder && typeof workspaceData.folder === 'string') {
                    const decodedPath = decodeWorkspacePath(workspaceData.folder);
                    const currentWorkspaceBaseName = basename(decodedPath); // Get the base name

                    // Compare base names (case-insensitive)
                    if (currentWorkspaceBaseName.toLowerCase() === targetWorkspaceName.toLowerCase()) {
                        console.log(`\n--- MATCH FOUND ---`);
                        console.log(`  Workspace ID (Dir):          ${workspaceId}`);
                        console.log(`  Target Name Argument:        ${targetWorkspaceName}`);
                        console.log(`  Name from workspace.json:    ${currentWorkspaceBaseName}`);
                        console.log(`  DB Path:                     ${dbPath}`);
                        console.log(`--------------------`);
                        foundMatch = true;
                        targetDbPath = dbPath; // Store the DB path
                        targetWorkspaceId = workspaceId;
                        break; // Stop after finding the first match
                    }
                } else {
                    // console.log(`  workspace.json missing 'folder' property or invalid format for ${workspaceId}.`);
                }
            } catch (jsonError) {
                console.error(`  Error reading or parsing workspace.json for ${workspaceId}:`, jsonError);
            }
        } // End loop through directories

        if (!foundMatch) {
            console.log(`\nNo workspace found matching the target name: "${targetWorkspaceName}"`);
            return; // Exit if no match
        }

    } catch (error) {
        console.error("Error accessing workspace storage directory:", error);
        throw error;
    }

    // --- UNCOMMENTED and MODIFIED: Inspect the found DB ---
    if (!targetDbPath) {
        console.error("Internal error: Match found but target DB path is null.");
        return;
    }

    console.log(`\n--- Inspecting Target Workspace DB: ${targetDbPath} ---`);
    let db: Database.Database | null = null;
    try {
        console.log("Attempting to connect to DB...");
        db = new Database(targetDbPath, { fileMustExist: true, readonly: true });
        console.log("DB Connected.");

        // 1. Inspect ItemTable
        const itemTableKeysToInspect = ['composer.composerData', 'workbench.editors.textResourceEditor']; // Keys used in getWorkspaceInfo
        console.log(`\n--- Inspecting ItemTable ---`);
        console.log(`Checking keys: ${itemTableKeysToInspect.join(', ')}`);
        let foundItemTableData = false;
        try {
            const stmt = db.prepare("SELECT key, value FROM ItemTable WHERE key = ?");
            for (const key of itemTableKeysToInspect) {
                const row = stmt.get(key) as undefined | { key: string; value: string }; // Assuming value is string for ItemTable JSON
                if (row?.value) {
                    console.log(`\nFound data for key '${row.key}' in ItemTable:`);
                    try {
                        const data = JSON.parse(row.value);
                        analyzeDataStructure(data, `ItemTable Key: ${row.key}`, "  ");
                        console.log(`  Raw JSON (first 500 chars): ${row.value.slice(0, 500)}${row.value.length > 500 ? '...' : ''}`);
                        foundItemTableData = true;
                        // break; // Optional: Stop after finding the first relevant key
                    } catch (jsonError) {
                        console.error(`  Error parsing JSON for key ${row.key}:`, jsonError);
                        console.log(`  Raw Value (first 500 chars): ${row.value.slice(0, 500)}${row.value.length > 500 ? '...' : ''}`);
                    }
                } else {
                    console.log(`Key '${key}' not found in ItemTable.`);
                }
            }
        } catch (dbError) {
            console.error(`Error querying ItemTable:`, dbError);
        }

        if (!foundItemTableData) {
            console.log("No relevant data found in ItemTable for specified keys.");
        }

        // 2. Inspect cursorDiskKV table
        console.log(`\n--- Inspecting cursorDiskKV ---`);
        let foundCursorKvData = false;
        try {
            // Check if table exists first
            const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cursorDiskKV'").get();
            if (tableCheck) {
                console.log("Table 'cursorDiskKV' exists. Querying for 'composerData:%' keys (LIMIT 5)...");
                const kvStmt = db.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%' LIMIT 5");
                const kvRows = kvStmt.all() as { key: string; value: Buffer }[];

                if (kvRows.length === 0) {
                    console.log("No rows found in cursorDiskKV with key like 'composerData:%'.");
                } else {
                    console.log(`Found ${kvRows.length} rows matching 'composerData:%'. Analyzing first row:`);
                    foundCursorKvData = true;
                    const firstRow = kvRows[0];
                    try {
                        const rawJson = firstRow.value.toString('utf8');
                        const data = JSON.parse(rawJson);
                        analyzeDataStructure(data, `cursorDiskKV Key: ${firstRow.key}`, "  ");
                        console.log(`  Raw JSON (first 500 chars): ${rawJson.slice(0, 500)}${rawJson.length > 500 ? '...' : ''}`);
                        if (kvRows.length > 1) {
                            console.log(`  (${kvRows.length - 1} more rows found but not analyzed)`);
                        }
                    } catch (jsonError) {
                        console.error(`  Error parsing JSON for key ${firstRow.key}:`, jsonError);
                        const rawJson = firstRow.value.toString('utf8');
                        console.log(`  Raw Value (first 500 chars): ${rawJson.slice(0, 500)}${rawJson.length > 500 ? '...' : ''}`);
                    }
                }
            } else {
                console.log("Table 'cursorDiskKV' does not exist in this database.");
            }
        } catch (dbError) {
            console.error(`Error querying cursorDiskKV:`, dbError);
        }

        if (!foundCursorKvData && tableCheck) {
            console.log("No relevant data found in cursorDiskKV.");
        }

        console.log(`\n--- End DB Inspection ---`);

    } catch (error) {
        console.error("An error occurred during DB inspection:", error);
        // Don't re-throw, allow finally block to run
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

main().catch(error => {
    console.error("Unhandled error in main execution:", error);
}); 