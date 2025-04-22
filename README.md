cursor-history
=================

A fast CLI for exporting, searching and pruning [Cursor](https://cursor.sh) conversation history, built with TypeScript + oclif.

---

## Installation — TL;DR

```bash
# with npm (uses pre‑built binaries automatically)
npm install -g @johnlindquist/cursor-history

# with pnpm ≥ 10 (read the next section!)
PNPM_ENABLE_PREBUILDS=true pnpm add -g @johnlindquist/cursor-history
```

> **Why two commands?** `cursor‑history` depends on **better‑sqlite3**, a native add‑on. npm will download a ready‑made binary for your platform; pnpm *won't* unless you flip an opt‑in flag. Details below.  
> When the binary is missing you'll get the famous `Could not locate the bindings file` stack‑trace at runtime.

---

## Basic usage

```bash
# Export the latest conversation to a Markdown file + clipboard
chi

# Extract *all* conversations to ./conversations/<timestamp>/*
chi --extract

# Fuzzy‑search by title and copy the chosen conversation to clipboard
chi --search

# Manage old exports (delete older than 30 d)
chi --manage --older-than 30d
```

See `chi --help` for the full command list.

---

## Troubleshooting checklist

1. `node -p "process.versions.modules"` returns **115** on Node 20; match that to the folder name in `better-sqlite3/lib/binding`. ([github.com](https://github.com/JoshuaWise/better-sqlite3/releases?utm_source=chatgpt.com))  
2. Make sure you're *actually* running the pnpm‑installed binary: `which chi`.  
3. Delete stale global installs (`pnpm uninstall -g`, `npm uninstall -g`) before switching package managers.

---

## Using pnpm with native modules

### What's happening under the hood?

| Step | npm | pnpm ≤ 10 default |
|------|-----|-------------------|
| Install `better‑sqlite3` | Downloads **pre‑built** `better_sqlite3.node` that matches your Node ABI (`node‑v115‑darwin‑arm64`, etc.) | Skips the prebuild and **blocks the post‑install compile script** unless the package is in the allow‑list |
| Runtime | `require('better-sqlite3')` finds the binary and works | Throws *Could not locate the bindings file* |

The pnpm behaviour is intentional: it prevents unreviewed packages from running arbitrary build scripts on your machine. You have three ways to opt‑in:

1. **Turn on the prebuild switch** (the quickest fix) 🟢

   ```bash
   PNPM_ENABLE_PREBUILDS=true pnpm add -g @johnlindquist/cursor-history
   ```

   The env‑var (or the matching `.npmrc` key `enable-prebuilt-binary=true`) tells pnpm to download official prebuilt binaries for *all* packages that ship them, including `better‑sqlite3`. No compilation needed. ([github.com](https://github.com/WiseLibs/better-sqlite3/issues/782?utm_source=chatgpt.com), [github.com](https://github.com/pnpm/pnpm/issues/2135?utm_source=chatgpt.com))

2. **Manually approve the build scripts** 🟡

   If you forgot the flag and saw

   ```
   Ignored build scripts: better-sqlite3, sqlite3.
   Run "pnpm approve-builds -g" to pick which dependencies should be allowed to run scripts.
   ```

   just do it:

   ```bash
   pnpm approve-builds -g   # interactive prompt ‑ pick better‑sqlite3 & sqlite3
   ```

   This whitelists the packages globally and re‑runs their `install`/`postinstall` scripts, compiling the native addon from source. Docs: `pnpm approve-builds` was added in v10.1 and gained the `‑g` flag in v10.4. ([pnpm.io](https://pnpm.io/cli/approve-builds), [github.com](https://github.com/pnpm/pnpm/issues/9045?utm_source=chatgpt.com))

3. **Force a rebuild** 🔧

   ```bash
   # prerequisite tool‑chain once per machine
   xcode-select --install      # macOS — installs clang & make
   pnpm install -g node-gyp    # wrapper around gyp

   # then, inside the global store path
   cd "$(pnpm root -g)/.pnpm/better-sqlite3@*/node_modules/better-sqlite3"
   pnpm rebuild                # runs node-gyp from source
   ```

   Use this when you *need* a from‑source build (e.g. bleeding‑edge Node version without prebuilds). ([github.com](https://github.com/pnpm/pnpm/issues/8228?utm_source=chatgpt.com), [github.com](https://github.com/WiseLibs/better-sqlite3/issues/1027?utm_source=chatgpt.com))

### FAQ

* **Do I have to do this every time?**  
  No. Set the flag once in your user npmrc:  
  `pnpm config set enable-prebuilt-binary true` or export the env variable from your shell profile.
* **What if I see `arm64e` vs `arm64` errors?**  
  You're probably mixing Rosetta and native Node builds. Re‑install Node with the same architecture as your terminal session. ([github.com](https://github.com/WiseLibs/better-sqlite3/issues/861?utm_source=chatgpt.com))
* **Is there a prebuild‑only fork?**  
  Yes, `better-sqlite3-with-prebuilds` publishes the binary directly in the tarball, avoiding the download step altogether. Feel free to swap it in your own projects. cite turn1search9

---

## Contributing

PRs and issues are welcome! If you have ideas for smoothing out the native‑module install story (post‑install hook, binary‑safe fork, Docker build, etc.) open a discussion.

---

© 2025 John Lindquist — MIT

