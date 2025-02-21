cursor-history
=================

A new CLI generated with oclif


[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/cursor-history.svg)](https://npmjs.org/package/cursor-history)
[![Downloads/week](https://img.shields.io/npm/dw/cursor-history.svg)](https://npmjs.org/package/cursor-history)


<!-- toc -->
* [Usage](#usage)
* [Commands](#commands)
<!-- tocstop -->
# Usage
<!-- usage -->
```sh-session
$ npm install -g cursor-history
$ chi COMMAND
running command...
$ chi (--version)
cursor-history/0.0.0 darwin-arm64 node-v23.6.1
$ chi --help [COMMAND]
USAGE
  $ chi COMMAND
...
```
<!-- usagestop -->
# Commands
<!-- commands -->
* [`chi hello PERSON`](#chi-hello-person)
* [`chi hello world`](#chi-hello-world)
* [`chi help [COMMAND]`](#chi-help-command)
* [`chi plugins`](#chi-plugins)
* [`chi plugins add PLUGIN`](#chi-plugins-add-plugin)
* [`chi plugins:inspect PLUGIN...`](#chi-pluginsinspect-plugin)
* [`chi plugins install PLUGIN`](#chi-plugins-install-plugin)
* [`chi plugins link PATH`](#chi-plugins-link-path)
* [`chi plugins remove [PLUGIN]`](#chi-plugins-remove-plugin)
* [`chi plugins reset`](#chi-plugins-reset)
* [`chi plugins uninstall [PLUGIN]`](#chi-plugins-uninstall-plugin)
* [`chi plugins unlink [PLUGIN]`](#chi-plugins-unlink-plugin)
* [`chi plugins update`](#chi-plugins-update)

## `chi hello PERSON`

Say hello

```
USAGE
  $ chi hello PERSON -f <value>

ARGUMENTS
  PERSON  Person to say hello to

FLAGS
  -f, --from=<value>  (required) Who is saying hello

DESCRIPTION
  Say hello

EXAMPLES
  $ chi hello friend --from oclif
  hello friend from oclif! (./src/commands/hello/index.ts)
```

_See code: [src/commands/hello/index.ts](https://github.com/johnlindquist/cursor-history/blob/v0.0.0/src/commands/hello/index.ts)_

## `chi hello world`

Say hello world

```
USAGE
  $ chi hello world

DESCRIPTION
  Say hello world

EXAMPLES
  $ chi hello world
  hello world! (./src/commands/hello/world.ts)
```

_See code: [src/commands/hello/world.ts](https://github.com/johnlindquist/cursor-history/blob/v0.0.0/src/commands/hello/world.ts)_

## `chi help [COMMAND]`

Display help for chi.

```
USAGE
  $ chi help [COMMAND...] [-n]

ARGUMENTS
  COMMAND...  Command to show help for.

FLAGS
  -n, --nested-commands  Include all nested commands in the output.

DESCRIPTION
  Display help for chi.
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v6.2.25/src/commands/help.ts)_

## `chi plugins`

List installed plugins.

```
USAGE
  $ chi plugins [--json] [--core]

FLAGS
  --core  Show core plugins.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List installed plugins.

EXAMPLES
  $ chi plugins
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.33/src/commands/plugins/index.ts)_

## `chi plugins add PLUGIN`

Installs a plugin into chi.

```
USAGE
  $ chi plugins add PLUGIN... [--json] [-f] [-h] [-s | -v]

ARGUMENTS
  PLUGIN...  Plugin to install.

FLAGS
  -f, --force    Force npm to fetch remote resources even if a local copy exists on disk.
  -h, --help     Show CLI help.
  -s, --silent   Silences npm output.
  -v, --verbose  Show verbose npm output.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Installs a plugin into chi.

  Uses npm to install plugins.

  Installation of a user-installed plugin will override a core plugin.

  Use the CHI_NPM_LOG_LEVEL environment variable to set the npm loglevel.
  Use the CHI_NPM_REGISTRY environment variable to set the npm registry.

ALIASES
  $ chi plugins add

EXAMPLES
  Install a plugin from npm registry.

    $ chi plugins add myplugin

  Install a plugin from a github url.

    $ chi plugins add https://github.com/someuser/someplugin

  Install a plugin from a github slug.

    $ chi plugins add someuser/someplugin
```

## `chi plugins:inspect PLUGIN...`

Displays installation properties of a plugin.

```
USAGE
  $ chi plugins inspect PLUGIN...

ARGUMENTS
  PLUGIN...  [default: .] Plugin to inspect.

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Displays installation properties of a plugin.

EXAMPLES
  $ chi plugins inspect myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.33/src/commands/plugins/inspect.ts)_

## `chi plugins install PLUGIN`

Installs a plugin into chi.

```
USAGE
  $ chi plugins install PLUGIN... [--json] [-f] [-h] [-s | -v]

ARGUMENTS
  PLUGIN...  Plugin to install.

FLAGS
  -f, --force    Force npm to fetch remote resources even if a local copy exists on disk.
  -h, --help     Show CLI help.
  -s, --silent   Silences npm output.
  -v, --verbose  Show verbose npm output.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Installs a plugin into chi.

  Uses npm to install plugins.

  Installation of a user-installed plugin will override a core plugin.

  Use the CHI_NPM_LOG_LEVEL environment variable to set the npm loglevel.
  Use the CHI_NPM_REGISTRY environment variable to set the npm registry.

ALIASES
  $ chi plugins add

EXAMPLES
  Install a plugin from npm registry.

    $ chi plugins install myplugin

  Install a plugin from a github url.

    $ chi plugins install https://github.com/someuser/someplugin

  Install a plugin from a github slug.

    $ chi plugins install someuser/someplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.33/src/commands/plugins/install.ts)_

## `chi plugins link PATH`

Links a plugin into the CLI for development.

```
USAGE
  $ chi plugins link PATH [-h] [--install] [-v]

ARGUMENTS
  PATH  [default: .] path to plugin

FLAGS
  -h, --help          Show CLI help.
  -v, --verbose
      --[no-]install  Install dependencies after linking the plugin.

DESCRIPTION
  Links a plugin into the CLI for development.

  Installation of a linked plugin will override a user-installed or core plugin.

  e.g. If you have a user-installed or core plugin that has a 'hello' command, installing a linked plugin with a 'hello'
  command will override the user-installed or core plugin implementation. This is useful for development work.


EXAMPLES
  $ chi plugins link myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.33/src/commands/plugins/link.ts)_

## `chi plugins remove [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ chi plugins remove [PLUGIN...] [-h] [-v]

ARGUMENTS
  PLUGIN...  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ chi plugins unlink
  $ chi plugins remove

EXAMPLES
  $ chi plugins remove myplugin
```

## `chi plugins reset`

Remove all user-installed and linked plugins.

```
USAGE
  $ chi plugins reset [--hard] [--reinstall]

FLAGS
  --hard       Delete node_modules and package manager related files in addition to uninstalling plugins.
  --reinstall  Reinstall all plugins after uninstalling.
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.33/src/commands/plugins/reset.ts)_

## `chi plugins uninstall [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ chi plugins uninstall [PLUGIN...] [-h] [-v]

ARGUMENTS
  PLUGIN...  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ chi plugins unlink
  $ chi plugins remove

EXAMPLES
  $ chi plugins uninstall myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.33/src/commands/plugins/uninstall.ts)_

## `chi plugins unlink [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ chi plugins unlink [PLUGIN...] [-h] [-v]

ARGUMENTS
  PLUGIN...  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ chi plugins unlink
  $ chi plugins remove

EXAMPLES
  $ chi plugins unlink myplugin
```

## `chi plugins update`

Update installed plugins.

```
USAGE
  $ chi plugins update [-h] [-v]

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Update installed plugins.
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.33/src/commands/plugins/update.ts)_
<!-- commandsstop -->
