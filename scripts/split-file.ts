// split-file.ts
// Usage: bun run scripts/split-file.ts <file-to-split>
// Splits a file into 20,000-line chunks if it exceeds that length, saving chunks next to the original file.
// Each chunk is named <original>_N<ext> (e.g., myfile_1.txt, myfile_2.txt)
//
// Example: bun run scripts/split-file.ts ./largefile.txt

import * as fs from 'node:fs';
import * as path from 'node:path';

const CHUNK_SIZE = 20_000;

function usage() {
    console.error('Usage: bun run scripts/split-file.ts <file-to-split>');
    process.exit(1);
}

if (process.argv.length < 3) {
    usage();
}

const filePath = process.argv[2];
if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
}

const fileContent = fs.readFileSync(filePath, 'utf8');
const lines = fileContent.split('\n');

if (lines.length <= CHUNK_SIZE) {
    console.log('File has less than or equal to 20,000 lines. No split needed.');
    process.exit(0);
}

const dir = path.dirname(filePath);
const ext = path.extname(filePath);
const base = path.basename(filePath, ext);

let chunkIndex = 1;
for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
    const chunkLines = lines.slice(i, i + CHUNK_SIZE);
    const chunkFileName = path.join(dir, `${base}_${chunkIndex}${ext}`);
    fs.writeFileSync(chunkFileName, chunkLines.join('\n'));
    console.log(`Wrote ${chunkFileName} (${chunkLines.length} lines)`);
    chunkIndex++;
} 