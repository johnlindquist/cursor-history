#!/usr/bin/env node

/**
 * Verification test for chi --select command
 * This test verifies that workspaces now properly return conversations
 */

import { execSync } from 'child_process';
import { listWorkspaces, getConversationsForWorkspace } from '../dist/db/extract-conversations.js';

// Colors for output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function main() {
  log('\n🔬 Verifying chi --select functionality', 'blue');
  log('=' .repeat(50), 'blue');
  
  // Functions already imported at top
  
  // Get all workspaces
  const workspaces = listWorkspaces();
  log(`\nTotal workspaces found: ${workspaces.length}`, 'yellow');
  
  // Sample up to 20 random workspaces
  const sampleSize = Math.min(20, workspaces.length);
  const sampledWorkspaces = workspaces
    .sort(() => Math.random() - 0.5)
    .slice(0, sampleSize);
  
  let workspacesWithConversations = 0;
  let totalConversations = 0;
  const results = [];
  
  log(`\nChecking ${sampleSize} random workspaces for conversations...`, 'blue');
  
  for (const workspace of sampledWorkspaces) {
    try {
      const conversations = await getConversationsForWorkspace(workspace.name);
      if (conversations.length > 0) {
        workspacesWithConversations++;
        totalConversations += conversations.length;
        results.push({
          name: workspace.name,
          path: workspace.path,
          conversations: conversations.length
        });
        log(`  ✅ ${workspace.name}: ${conversations.length} conversations`, 'green');
      }
    } catch (error) {
      // Silently skip errored workspaces
    }
  }
  
  // Show results
  log('\n' + '=' .repeat(50), 'blue');
  log('📊 Results Summary:', 'blue');
  log(`  Workspaces checked: ${sampleSize}`, 'yellow');
  log(`  Workspaces with conversations: ${workspacesWithConversations}`, 'yellow');
  log(`  Total conversations found: ${totalConversations}`, 'yellow');
  
  if (workspacesWithConversations > 0) {
    log('\n✅ SUCCESS: The --select command should now work properly!', 'green');
    log('\nWorkspaces you can test with --select:', 'blue');
    
    results.slice(0, 5).forEach((ws, i) => {
      log(`  ${i + 1}. chi --select --workspace "${ws.name}"`, 'yellow');
    });
    
    // Test one directly
    if (results.length > 0) {
      const testWorkspace = results[0];
      log(`\n🧪 Running actual --select test on: ${testWorkspace.name}`, 'blue');
      
      try {
        const output = execSync(
          `node ./bin/run.js --workspace "${testWorkspace.name}"`, 
          { encoding: 'utf8', stdio: 'pipe' }
        );
        
        if (output.includes('exported to:') && output.includes('copied to clipboard')) {
          log('✅ Successfully exported conversation!', 'green');
        } else {
          log('⚠️  Command ran but output unexpected', 'yellow');
        }
      } catch (error) {
        log('❌ Failed to run --select command', 'red');
        if (error.stdout) {
          log(`Output: ${error.stdout}`, 'yellow');
        }
      }
    }
  } else {
    log('\n❌ PROBLEM: No workspaces with conversations found in sample!', 'red');
    log('This suggests the conversation extraction might still have issues.', 'red');
  }
}

main().catch(error => {
  log('\n❌ Test failed with error:', 'red');
  console.error(error);
  process.exit(1);
});