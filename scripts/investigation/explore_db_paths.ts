import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { join } from 'node:path';

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

    // Adjusted path based on recent VS Code/Cursor changes
    // return join(basePath, 'User/globalStorage/state.vscdb'); 
    return join(basePath, 'User/globalStorage/storage.db'); // Common new path
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

async function main() {
    console.log('--- Database Path Check ---');

    const globalDbPath = getCursorDbPath();
    console.log(`Expected Global DB Path: ${globalDbPath}`);
    if (globalDbPath) {
        console.log(`Global DB Exists: ${existsSync(globalDbPath)}`);
        // Let's also check the old path
        const oldGlobalDbPath = globalDbPath.replace('storage.db', 'state.vscdb');
        console.log(`Old Global DB Path (${oldGlobalDbPath}) Exists: ${existsSync(oldGlobalDbPath)}`);
    } else {
        console.log('Could not determine Global DB path.');
    }

    const workspaceStoragePath = getWorkspaceStoragePath();
    console.log(`\nExpected Workspace Storage Path: ${workspaceStoragePath}`);
    if (workspaceStoragePath) {
        console.log(`Workspace Storage Exists: ${existsSync(workspaceStoragePath)}`);
        // Optional: List first few entries to see if it looks like workspace IDs
        // try {
        //   const entries = readdirSync(workspaceStoragePath, { withFileTypes: true });
        //   console.log(`Workspace Storage Contents (sample):`, entries.slice(0, 5).map(e => e.name));
        // } catch (err) { console.error("Error reading workspace dir:", err); }
    } else {
        console.log('Could not determine Workspace Storage path.');
    }

    console.log('\n--- End Check ---');
}

main().catch(console.error); 