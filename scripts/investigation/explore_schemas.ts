import Database from 'better-sqlite3';
import { existsSync, readdirSync } from 'node:fs';
import { platform } from 'node:os';
import { join } from 'node:path';

// --- Re-used functions ---
function getCursorDbPath(): null | string {
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

    // Use the confirmed path from Step 1
    return join(basePath, 'User/globalStorage/state.vscdb');
}

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
// --- END Re-used functions ---

function printSchema(dbPath: string) {
    if (!existsSync(dbPath)) {
        console.log(`Database not found at: ${dbPath}\n`);
        return;
    }

    console.log(`--- Schema for ${dbPath} ---`);
    let db: Database.Database | null = null;
    try {
        db = new Database(dbPath, { fileMustExist: true, readonly: true });
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        console.log('Tables:', tables.map((t: any) => t.name).join(', '));

        for (const table of tables) {
            const tableName = (table as { name: string }).name;
            if (tableName.startsWith('sqlite_')) continue; // Skip internal tables
            console.log(`\nSchema for table "${tableName}":`);
            try {
                const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
                console.log(columns);
            } catch (pragmaError) {
                console.error(`Error getting PRAGMA info for ${tableName}:`, pragmaError);
            }
        }
    } catch (error) {
        console.error(`Error reading schema from ${dbPath}:`, error);
    } finally {
        db?.close();
    }

    console.log(`--- End Schema for ${dbPath} ---\n`);
}

// Using top-level logic directly for simplicity in script
const globalDbPath = getCursorDbPath();
if (globalDbPath) {
    printSchema(globalDbPath);
} else {
    console.log('Could not determine Global DB path.');
}

const workspaceStoragePath = getWorkspaceStoragePath();
if (workspaceStoragePath && existsSync(workspaceStoragePath)) {
    try {
        const workspaceDirs = readdirSync(workspaceStoragePath, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory() && !dirent.name.startsWith('.')) // Exclude hidden
            .map(dirent => dirent.name);

        if (workspaceDirs.length > 0) {
            // Analyze the first *non-hidden* workspace found
            const firstWorkspaceId = workspaceDirs[0];
            // Use the standard workspace DB name
            const workspaceDbPath = join(workspaceStoragePath, firstWorkspaceId, 'state.vscdb');
            console.log(`\nAnalyzing sample workspace DB: ${workspaceDbPath}`);
            printSchema(workspaceDbPath);
        } else {
            console.log('No non-hidden workspace directories found to analyze.');
        }
    } catch (error) {
        console.error("Error accessing workspace storage:", error);
    }
} else {
    console.log('Workspace storage path not found or inaccessible.')
} 