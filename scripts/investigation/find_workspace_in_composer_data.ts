import Database from 'better-sqlite3';
import { join } from 'node:path';
import { homedir } from 'node:os';

const GLOBAL_DB = join(
    homedir(),
    'Library/Application Support/Cursor/User/globalStorage/state.vscdb'
);

const NEEDLES = [
    'github-examples',
    'ghx',
    'f91df5de23446631f6e0437f1e506e0b',
];

function searchObject(obj: any, needles: string[]): string[] {
    const found: string[] = [];
    function recur(val: any) {
        if (typeof val === 'string') {
            for (const needle of needles) {
                if (val.toLowerCase().includes(needle.toLowerCase())) {
                    found.push(val);
                }
            }
        } else if (Array.isArray(val)) {
            for (const el of val) recur(el);
        } else if (val && typeof val === 'object') {
            for (const v of Object.values(val)) recur(v);
        }
    }
    recur(obj);
    return found;
}

function main() {
    const db = new Database(GLOBAL_DB, { readonly: true });
    const rows = db.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'").all();
    let matchCount = 0;
    let printed = 0;
    for (const row of rows) {
        try {
            const raw = row.value instanceof Buffer ? row.value.toString('utf8') : row.value;
            const parsed = JSON.parse(raw);
            const matches = searchObject(parsed, NEEDLES);
            if (matches.length > 0 && printed < 5) {
                matchCount++;
                printed++;
                console.log(`---\nKey: ${row.key}`);
                for (const match of matches) {
                    console.log(`  Match: ${match.slice(0, 200)}`);
                }
                // Print all string fields in the object
                const allStrings: string[] = [];
                const collectStrings = (obj: any, depth = 0) => {
                    if (depth > 10) return;
                    if (typeof obj === 'string') allStrings.push(obj);
                    else if (Array.isArray(obj)) {
                        for (const el of obj) collectStrings(el, depth + 1);
                    } else if (obj && typeof obj === 'object') {
                        for (const v of Object.values(obj)) collectStrings(v, depth + 1);
                    }
                };
                collectStrings(parsed);
                console.log('  All string fields:');
                for (const s of allStrings) {
                    console.log('    ', s);
                }
            }
        } catch (e) {
            // skip
        }
    }
    console.log(`\nTotal composerData entries with matches: ${matchCount}`);
}

main(); 