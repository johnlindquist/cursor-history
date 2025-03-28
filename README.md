cursor-history
=================

A new CLI generated with oclif


[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/cursor-history.svg)](https://npmjs.org/package/cursor-history)
[![Downloads/week](https://img.shields.io/npm/dw/cursor-history.svg)](https://npmjs.org/package/cursor-history)


<!-- toc -->
* [Installation](#installation)
* [Usage](#usage)
* [Commands](#commands)
<!-- tocstop -->

# Installation

```sh-session
$ pnpm add -g @johnlindquist/cursor-history
```

## Troubleshooting Installation

If you encounter issues with native module builds (particularly with better-sqlite3), try the following:

1. Ensure node-gyp is installed globally:
```sh-session
$ pnpm install -g node-gyp
```

2. Install with prebuilds enabled:
```sh-session
$ PNPM_ENABLE_PREBUILDS=true pnpm add -g @johnlindquist/cursor-history
```

3. If still having issues, try rebuilding better-sqlite3:
```sh-session
$ cd $(pnpm root -g)/.pnpm/better-sqlite3@*/node_modules/better-sqlite3
$ pnpm rebuild
```

# Usage
<!-- usage -->
```sh-session
$ npm install -g @johnlindquist/cursor-history
$ chi COMMAND
running command...
$ chi (--version)
@johnlindquist/cursor-history/0.0.13 linux-x64 node-v20.18.2
$ chi --help [COMMAND]
USAGE
  $ chi COMMAND
...
```
<!-- usagestop -->
# Commands
<!-- commands -->
* [`chi`](#chi)
* [`chi --extract`](#chi--extract)
* [`chi --search`](#chi--search)
* [`chi --select`](#chi--select)
* [`chi --manage`](#chi--manage)

## `chi`

Extract the latest conversation for the current workspace (or global latest if none found).

```
USAGE
  $ chi [-h] [-v]

FLAGS
  -h, --help     Show CLI help.
  -v, --version  Show CLI version.

DESCRIPTION
  Extract the latest conversation for the current workspace (or global latest if none found).
```

## `chi --extract`

Extract all conversations to markdown files.

```
USAGE
  $ chi --extract [-h]

FLAGS
  -e, --extract  Extract all conversations to markdown files
  -h, --help     Show CLI help.

DESCRIPTION
  Extract all conversations to markdown files organized by timestamp.
```

## `chi --search`

Interactively search and view conversations.

```
USAGE
  $ chi --search [-h]

FLAGS
  -s, --search   Interactively search and view conversations
  -h, --help     Show CLI help.

DESCRIPTION
  Interactively search through conversation history and view/export selected conversations.
```

## `chi --select`

Select a workspace, list its conversations, and copy selected conversation to clipboard.

```
USAGE
  $ chi --select [-h]

FLAGS
  -l, --select   Select a workspace and conversation
  -h, --help     Show CLI help.

DESCRIPTION
  If current directory matches a workspace, list its conversations.
  Otherwise, select a workspace, list its conversations, and copy one to clipboard.
```

## `chi --manage`

Manage extracted conversation files by pruning or archiving old files.

```
USAGE
  $ chi --manage --older-than DURATION [--archive] [-h]

FLAGS
  -m, --manage           Manage extracted conversation files
  --older-than DURATION  Remove files older than specified duration (e.g., 30d for 30 days, 2w for 2 weeks, 1m for 1 month)
  --archive              Archive old conversations instead of deleting them
  -h, --help             Show CLI help.

DESCRIPTION
  Manage extracted conversation files by removing or archiving files older than a specified duration.
  
  Duration format examples:
  - 30d: 30 days
  - 2w: 2 weeks
  - 1m: 1 month (approximately 30 days)
  
  When using --archive, files are moved to an 'archive' subdirectory instead of being deleted.
```
<!-- commandsstop -->
