"use strict";
// split-file.ts
// Usage: ts-node split-file.ts <file-to-split>
// Splits a file into 20,000-line chunks if it exceeds that length, saving chunks next to the original file.
// Each chunk is named <original>_N<ext> (e.g., myfile_1.txt, myfile_2.txt)
//
// Example: ts-node split-file.ts ./largefile.txt
Object.defineProperty(exports, "__esModule", { value: true });
!/usr/bin / env;
ts - node;
var fs = require("fs");
var path = require("path");
var CHUNK_SIZE = 20000;
function usage() {
    console.error('Usage: ts-node split-file.ts <file-to-split>');
    process.exit(1);
}
if (process.argv.length < 3) {
    usage();
}
var filePath = process.argv[2];
if (!fs.existsSync(filePath)) {
    console.error("File not found: ".concat(filePath));
    process.exit(1);
}
var fileContent = fs.readFileSync(filePath, 'utf-8');
var lines = fileContent.split('\n');
if (lines.length <= CHUNK_SIZE) {
    console.log('File has less than or equal to 20,000 lines. No split needed.');
    process.exit(0);
}
var dir = path.dirname(filePath);
var ext = path.extname(filePath);
var base = path.basename(filePath, ext);
var chunkIndex = 1;
for (var i = 0; i < lines.length; i += CHUNK_SIZE) {
    var chunkLines = lines.slice(i, i + CHUNK_SIZE);
    var chunkFileName = path.join(dir, "".concat(base, "_").concat(chunkIndex).concat(ext));
    fs.writeFileSync(chunkFileName, chunkLines.join('\n'));
    console.log("Wrote ".concat(chunkFileName, " (").concat(chunkLines.length, " lines)"));
    chunkIndex++;
}
