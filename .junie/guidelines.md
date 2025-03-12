# Cursor History CLI Tool

## Project Overview

The Cursor History CLI tool (`chi`) is a command-line utility designed to extract, search, and manage conversation history from the Cursor editor. Cursor is an AI-assisted code editor, and this tool helps users access and analyze their interaction history with the AI assistant.

## Key Features

- Extract conversation history from the Cursor editor's database
- Search through conversation history
- Filter conversations by workspace
- View the latest conversations
- Process and display inline code diffs and code blocks

## Technical Details

- Built with TypeScript and Node.js
- Uses oclif (Open CLI Framework) for command-line interface structure
- Leverages better-sqlite3 for database interactions
- Cross-platform support (macOS, Linux, Windows)
- Provides both global and workspace-specific conversation extraction

## Project Structure

- `src/`: Source code
  - `db/`: Database interaction code
    - `extract-conversations.ts`: Core functionality for extracting conversations
  - Other modules for CLI commands and utilities
- `bin/`: Executable scripts
- `dist/`: Compiled JavaScript code
- `conversations/`: Storage for extracted conversations
- `global-conversations/`: Storage for global conversations

## Usage

The CLI can be invoked using the `chi` command with various options:
- Default: `chi` - Run the default command
- Extract: `chi --extract` - Extract conversations
- Search: `chi --search` - Search through conversations
- Select: `chi --select` - Select specific conversations

## Development Guidelines

1. Follow TypeScript best practices
2. Use async/await for asynchronous operations
3. Provide proper error handling and user feedback
4. Maintain cross-platform compatibility
5. Document new features and changes

## Installation

```sh
pnpm add -g @johnlindquist/cursor-history
```

## Contributing

Contributions are welcome! Please ensure your code follows the project's style and includes appropriate tests.