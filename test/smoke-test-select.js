#!/usr/bin/env node

/**
 * Smoke test for chi --select command
 * This test:
 * 1. Lists all workspaces
 * 2. Finds workspaces with conversations
 * 3. Tests --select on a random workspace with conversations
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { getConversationsForWorkspace, listWorkspaces } from '../dist/db/extract-conversations.js';

// Colors for output
const colors = {
  blue: '\u001B[34m',
  green: '\u001B[32m',
  red: '\u001B[31m',
  reset: '\u001B[0m',
  yellow: '\u001B[33m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function runCommand(command, options = {}) {
  try {
    const output = execSync(command, {
      encoding: 'utf8',
      stdio: 'pipe',
      ...options
    });
    return { output, success: true };
  } catch (error) {
    return { error, output: error.stdout || error.message, success: false };
  }
}

async function findWorkspaceWithConversations() {
  log('\n🔍 Finding workspaces with conversations...', 'blue');
  
  // First, get list of all workspaces using the chi tool
  const listResult = runCommand('node ./bin/run.js --extract --help');
  if (!listResult.success) {
    log('Failed to run chi command. Make sure you have built the project.', 'red');
    process.exit(1);
  }

  // Functions already imported at top
  
  const workspaces = listWorkspaces();
  log(`Found ${workspaces.length} total workspaces`, 'yellow');
  
  // Check each workspace for conversations
  const workspacesWithConversations = [];
  let checked = 0;
  
  for (const workspace of workspaces) {
    checked++;
    if (checked % 50 === 0) {
      process.stdout.write(`\rChecking workspace ${checked}/${workspaces.length}...`);
    }
    
    try {
      const conversations = await getConversationsForWorkspace(workspace.name);
      if (conversations.length > 0) {
        workspacesWithConversations.push({
          ...workspace,
          conversationCount: conversations.length
        });
      }
    } catch {
      // Skip workspaces that error out
    }
  }
  
  process.stdout.write('\r' + ' '.repeat(50) + '\r'); // Clear the progress line
  
  return workspacesWithConversations;
}

async function testSelectOnWorkspace(workspaceName) {
  log(`\n🧪 Testing --select on workspace: ${workspaceName}`, 'blue');
  
  // Run chi --select with the workspace flag
  const result = runCommand(`node ./bin/run.js --select --workspace "${workspaceName}"`, {
    timeout: 30_000 // 30 second timeout
  });
  
  if (!result.success) {
    log(`❌ Failed to run --select on workspace ${workspaceName}`, 'red');
    log(`Error: ${result.output}`, 'red');
    return false;
  }
  
  // Check if the output indicates success
  const {output} = result;
  const hasFoundConversations = output.includes('Found') && output.includes('conversations') && !output.includes('Found 0 conversations');
  const hasNoConversationsMessage = output.includes('No conversations found');
  
  if (hasFoundConversations && !hasNoConversationsMessage) {
    log(`✅ Successfully found conversations in ${workspaceName}`, 'green');
    
    // Extract conversation count from output
    const countMatch = output.match(/Found (\d+) conversations/);
    if (countMatch) {
      log(`   Conversations found: ${countMatch[1]}`, 'green');
    }
    
    return true;
  }
 
    log(`❌ No conversations found in ${workspaceName} (but they should exist!)`, 'red');
    log(`Output: ${output}`, 'yellow');
    return false;
  
}

async function runSmokeTest() {
  log('🚀 Starting smoke test for chi --select command', 'blue');
  log('=' .repeat(50), 'blue');
  
  // Build the project first
  log('\n📦 Building project...', 'yellow');
  const buildResult = runCommand('npm run build');
  if (!buildResult.success) {
    log('❌ Build failed!', 'red');
    log(buildResult.output, 'red');
    process.exit(1);
  }

  log('✅ Build successful', 'green');
  
  // Find workspaces with conversations
  const workspacesWithConversations = await findWorkspaceWithConversations();
  
  if (workspacesWithConversations.length === 0) {
    log('\n❌ No workspaces with conversations found!', 'red');
    log('This might indicate a problem with the conversation extraction logic.', 'red');
    process.exit(1);
  }
  
  log(`\n✅ Found ${workspacesWithConversations.length} workspaces with conversations`, 'green');
  
  // Show top 5 workspaces by conversation count
  const topWorkspaces = workspacesWithConversations
    .sort((a, b) => b.conversationCount - a.conversationCount)
    .slice(0, 5);
  
  log('\nTop workspaces by conversation count:', 'yellow');
  for (const [i, ws] of topWorkspaces.entries()) {
    log(`  ${i + 1}. ${ws.name} (${ws.conversationCount} conversations)`, 'yellow');
  }
  
  // Test --select on a random workspace with conversations
  const randomIndex = Math.floor(Math.random() * Math.min(10, workspacesWithConversations.length));
  const testWorkspace = workspacesWithConversations[randomIndex];
  
  const testResult = await testSelectOnWorkspace(testWorkspace.name);
  
  // Also test on the workspace with the most conversations
  if (topWorkspaces.length > 0 && topWorkspaces[0].name !== testWorkspace.name) {
    log('\n🧪 Also testing on workspace with most conversations...', 'blue');
    await testSelectOnWorkspace(topWorkspaces[0].name);
  }
  
  // Summary
  log('\n' + '=' .repeat(50), 'blue');
  log('📊 Smoke Test Summary:', 'blue');
  log(`  Total workspaces: ${workspacesWithConversations.length}`, 'yellow');
  log(`  Tested workspace: ${testWorkspace.name}`, 'yellow');
  log(`  Expected conversations: ${testWorkspace.conversationCount}`, 'yellow');
  log(`  Test result: ${testResult ? '✅ PASSED' : '❌ FAILED'}`, testResult ? 'green' : 'red');
  
  process.exit(testResult ? 0 : 1);
}

// Run the smoke test
runSmokeTest().catch(error => {
  log('\n❌ Unexpected error during smoke test:', 'red');
  console.error(error);
  process.exit(1);
});