#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Get the directory of the current script
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Project root is likely two levels up from scripts/
const projectRoot = join(__dirname, '..'); 

const targetDir = process.argv[2];
const cliScriptPath = join(projectRoot, 'bin', 'run.js');

if (!targetDir) {
  console.error('Error: No target directory specified.');
  console.error('Usage: node scripts/run-in-dir.js <target-directory>');
  process.exit(1);
}

console.log(`Building project...`);

// Run pnpm build first
const buildProcess = spawn('pnpm', ['build'], {
  cwd: projectRoot, // Run build from project root
  shell: true, // Use shell for pnpm command
  stdio: 'inherit'
});

buildProcess.on('close', (buildCode) => {
  if (buildCode !== 0) {
    console.error(`Build failed with code ${buildCode}`);
    process.exit(buildCode);
  }
  
  console.log(`Build complete. Running CLI in directory: ${targetDir}`);

  // Run the actual CLI script in the target directory
  const cliProcess = spawn(process.execPath, [cliScriptPath], { // Use node to execute the script
    cwd: targetDir, // Set the working directory for the CLI
    stdio: 'inherit' // Pass through stdin/stdout/stderr
  });

  cliProcess.on('close', (cliCode) => {
    console.log(`CLI process finished with code ${cliCode}`);
    process.exit(cliCode === null ? 1 : cliCode); // Exit with the CLI's code
  });

  cliProcess.on('error', (err) => {
    console.error('Failed to start CLI process:', err);
    process.exit(1);
  });
});

buildProcess.on('error', (err) => {
  console.error('Failed to start build process:', err);
  process.exit(1);
}); 