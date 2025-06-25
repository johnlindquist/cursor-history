#!/usr/bin/env node

/**
 * Test to verify ItemTable bubble lookup is working
 */

import BetterSqlite3 from 'better-sqlite3';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, basename } from 'path';
import { platform } from 'os';

function getWorkspaceStoragePath() {
  const os = platform();
  const home = process.env.HOME || process.env.USERPROFILE || '';
  
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

function decodeWorkspacePath(uri) {
  try {
    const path = uri.replace(/^file:\/\//, '');
    return decodeURIComponent(path);
  } catch (error) {
    return uri;
  }
}

console.log('🔍 Testing ItemTable bubble lookup...\n');

const workspaceStoragePath = getWorkspaceStoragePath();
const workspaces = readdirSync(workspaceStoragePath, { withFileTypes: true });

let tested = 0;
let foundInItemTable = 0;
let foundInCursorDiskKV = 0;

// Test up to 10 workspaces that have bubble IDs
for (const workspace of workspaces) {
  if (tested >= 10) break;
  if (!workspace.isDirectory()) continue;
  
  const dbPath = join(workspaceStoragePath, workspace.name, 'state.vscdb');
  if (!existsSync(dbPath)) continue;
  
  let db = null;
  try {
    db = new BetterSqlite3(dbPath, { fileMustExist: true, readonly: true });
    
    // Check if this workspace has composers with headers
    const composerResult = db.prepare("SELECT value FROM ItemTable WHERE key = 'composer.composerData'").get();
    if (!composerResult?.value) {
      db.close();
      continue;
    }
    
    const parsed = JSON.parse(composerResult.value);
    if (!parsed.allComposers || !Array.isArray(parsed.allComposers)) {
      db.close();
      continue;
    }
    
    // Find a composer with fullConversationHeadersOnly
    let bubbleIdToTest = null;
    let composerId = null;
    
    for (const composer of parsed.allComposers) {
      if (composer.fullConversationHeadersOnly && composer.fullConversationHeadersOnly.length > 0) {
        const header = composer.fullConversationHeadersOnly[0];
        if (header.bubbleId) {
          bubbleIdToTest = header.bubbleId;
          composerId = composer.composerId;
          break;
        }
      }
    }
    
    if (bubbleIdToTest) {
      tested++;
      const bubbleKey = `bubbleId:${composerId}:${bubbleIdToTest}`;
      
      // Try ItemTable first
      const itemTableRow = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(bubbleKey);
      if (itemTableRow?.value) {
        foundInItemTable++;
        console.log(`✅ Found in ItemTable: ${bubbleKey.substring(0, 50)}...`);
      } else {
        // Try cursorDiskKV
        const cursorDiskRow = db.prepare('SELECT value FROM cursorDiskKV WHERE key = ?').get(bubbleKey);
        if (cursorDiskRow?.value) {
          foundInCursorDiskKV++;
          console.log(`⚠️  Found in cursorDiskKV (old location): ${bubbleKey.substring(0, 50)}...`);
        } else {
          console.log(`❌ Not found in either table: ${bubbleKey.substring(0, 50)}...`);
        }
      }
    }
    
    db.close();
  } catch (error) {
    if (db) db.close();
  }
}

console.log('\n📊 Summary:');
console.log(`  Workspaces tested: ${tested}`);
console.log(`  Bubble IDs found in ItemTable (new): ${foundInItemTable}`);
console.log(`  Bubble IDs found in cursorDiskKV (old): ${foundInCursorDiskKV}`);
console.log(`  Not found in either: ${tested - foundInItemTable - foundInCursorDiskKV}`);

if (foundInItemTable > 0) {
  console.log('\n✅ ItemTable lookup is working! Recent Cursor builds store bubbles there.');
} else if (foundInCursorDiskKV > 0) {
  console.log('\n⚠️  Only found bubbles in old location. This workspace might be from an older Cursor version.');
} else if (tested === 0) {
  console.log('\n⚠️  No workspaces with bubble IDs found to test.');
} else {
  console.log('\n❌ No bubble IDs found in either table. They might be stored in the global DB only.');
}