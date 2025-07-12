# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

cursor-history is a CLI tool (`chi`) for managing and searching Cursor conversation history. It extracts conversations from Cursor's SQLite databases and exports them to markdown files.

## Essential Commands

### Development
```bash
# Build the project
pnpm build

# Run tests
pnpm test

# Run a single test file
pnpm mocha test/commands/default.test.ts

# Lint and format code (uses Biome)
pnpm lint

# Verify the --select command works
pnpm verify-select
pnpm smoke-test
```

### CLI Testing During Development
```bash
# Test default command (export latest conversation)
pnpm default

# Test extract all conversations
pnpm extract

# Test interactive search
pnpm search

# Test workspace/conversation selection
pnpm select

# Test file management
pnpm manage
```

## Architecture

### Core Components

1. **Database Extraction** (`src/db/extract-conversations.ts`)
   - Handles SQLite database queries from Cursor's internal databases
   - Supports multiple database formats and schemas
   - Robust error handling for various conversation data formats

2. **Command Structure** (`src/commands/`)
   - Single command implementation in `src/index.ts` using oclif
   - Flags control different modes: `--extract`, `--search`, `--select`, `--browse`, `--manage`
   - Each mode has distinct behavior for handling conversations

3. **Type System** (`src/types.ts`)
   - Defines `Conversation`, `Message`, and database query result types
   - Handles both legacy and current Cursor database schemas

4. **Utilities** (`src/utils/`)
   - `config.ts`: User configuration management
   - `format-conversation.ts`: Markdown formatting for conversations

### Key Implementation Details

- **ESM Modules**: Project uses `"type": "module"` with `.js` extensions in imports
- **Native Dependencies**: `better-sqlite3` requires special handling in pnpm (see README)
- **Code Style**: 
  - Biome for formatting (tabs, double quotes)
  - TypeScript with strict mode
  - No console.log allowed (use ora spinners or proper error handling)

### Database Locations
- macOS: `~/Library/Application Support/Cursor/User/workspaceStorage/`
- Global conversations: `~/Library/Application Support/Cursor/User/globalStorage/`
- Each workspace has its own `state.vscdb` SQLite database

### Error Handling Patterns
- Always check if databases exist before querying
- Handle both old and new Cursor database schemas
- Provide helpful error messages for common issues (missing workspace, no conversations)

## Testing Strategy

- Unit tests for commands using Mocha + Chai
- Smoke tests for CLI functionality verification
- Test utilities in `test/utils/` for database operations
- Mock database responses using Sinon when needed

## Release Process

Uses semantic-release for automated versioning and npm publishing. Commits should follow conventional commit format for proper version bumping.