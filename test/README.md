# Smoke Tests for chi --select

This directory contains smoke tests to verify that the `chi --select` command works properly after fixing the bubble ID reconstruction logic.

## Available Tests

### 1. `verify-select-works.js`
Quick verification test that:
- Samples 20 random workspaces
- Checks which ones have conversations
- Tests actual export on one workspace
- Shows you example commands to test manually

**Run:** `npm run verify-select`

### 2. `smoke-test-select.js`
Comprehensive smoke test that:
- Finds all workspaces with conversations
- Tests --select on random workspaces
- Provides detailed statistics
- Validates the output format

**Run:** `npm run smoke-test`

### 3. `test-itemtable-lookup.js`
Low-level test to verify ItemTable vs cursorDiskKV lookup for bubble messages.

**Run:** `node test/test-itemtable-lookup.js`

## What the Tests Verify

The tests confirm that after the fixes:
1. ✅ Workspaces with conversations are properly detected
2. ✅ The `--select` command finds and exports conversations
3. ✅ Both ItemTable (new) and cursorDiskKV (old) lookups work
4. ✅ The fallback global DB scan works when local data is incomplete

## Manual Testing

After running `npm run verify-select`, you'll see example commands like:
```bash
chi --select --workspace "workshop-2025-06-05"
chi --select --workspace ".config"
chi --select --workspace "turbo-with-tailwind-v4"
```

Run these commands to manually verify that conversations are found and exported.