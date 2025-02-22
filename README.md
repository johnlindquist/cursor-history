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
@johnlindquist/cursor-history/0.0.12 darwin-arm64 node-v23.4.0
$ chi --help [COMMAND]
USAGE
  $ chi COMMAND
...
```
<!-- usagestop -->
# Commands
<!-- commands -->
* [`chi`](#chi)

## `chi`

Update installed plugins.

```
USAGE
  $ chi  [-h] [-v]

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Update installed plugins.
```
<!-- commandsstop -->
