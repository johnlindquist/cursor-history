import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { platform, homedir } from 'node:os';
import Database from 'better-sqlite3';

function getWorkspaceStoragePath(): string {
    const os = platform();
    const home = homedir();
    switch (os) {
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

function previewValue(val: Buffer): string {
    try {
        const str = val.toString('utf8');
        if (str.trim().startsWith('{') || str.trim().startsWith('[')) {
            return str.slice(0, 200);
        }
        return str.slice(0, 200);
    } catch {
        return '[binary]';
    }
}

function main() {
    const workspaceStorage = getWorkspaceStoragePath();
    const dirs = readdirSync(workspaceStorage, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
    for (const dir of dirs) {
        const dbPath = join(workspaceStorage, dir, 'state.vscdb');
        if (!existsSync(dbPath)) continue;
        let db: Database | null = null;
        try {
            db = new Database(dbPath, { readonly: true });
            for (const table of ['ItemTable', 'cursorDiskKV']) {
                let rows: { key: string, value: Buffer }[] = [];
                try {
                    rows = db.prepare(`SELECT key, value FROM ${table}`).all();
                } catch { continue; }
                for (const row of rows) {
                    const preview = previewValue(row.value);
                    console.log(`[${dir}] ${table}: ${row.key}\n  Preview: ${preview.replace(/\n/g, ' ')}\n`);
                }
            }
        } catch (e) {
            console.error(`[${dir}] Error opening DB:`, e);
        } finally {
            db?.close();
        }
    }
}

main(); 