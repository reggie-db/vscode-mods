# vscode-mods

Small, fail-closed modifications for installed VS Code extensions. This is not
a VS Code Marketplace extension. Each directory under `mods/` is discovered
and applied independently by a standalone cross-platform runner.

The runner validates exact extension markers and patch match counts before it
writes anything. It creates a checksum-verified backup, replaces the target
through a same-directory temporary file, verifies the result, and records
restore state. A mismatch is logged and skipped. By default, failures still
return exit code zero so the runner cannot prevent VS Code startup.

## Install

macOS or Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/reggie-db/vscode-mods/main/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/reggie-db/vscode-mods/main/install.ps1 | iex
```

The installer downloads the latest GitHub release, verifies its SHA-256
checksum, installs the binary and bundled `mods/` directory, and applies every
available mod. Reload the VS Code window afterward.

If you prefer to inspect before executing, download `install.sh` or
`install.ps1`, review it, and run it locally.

## Commands

```sh
vscode-mods apply
vscode-mods list
vscode-mods restore
vscode-mods apply hide-codex-tool-hook-rows
vscode-mods apply --dry-run
```

Use `--extensions-dir PATH` for a nonstandard or portable VS Code extension
directory. Set `VSCODE_EXTENSIONS_DIR`, `VSCODE_INSIDERS_EXTENSIONS_DIR`, or
`VSCODE_PORTABLE` to configure discovery without command flags.

Windows installs the executable at
`%LOCALAPPDATA%\Programs\vscode-mods\bin\vscode-mods.exe` and prints that path.
macOS and Linux also create `~/.local/bin/vscode-mods`.

Logs and restore state live under:

- macOS/Linux: `${XDG_STATE_HOME:-~/.local/state}/vscode-mods`
- Windows: `%LOCALAPPDATA%\vscode-mods`

## Mods

Every immediate folder beneath `mods/` must contain a `mod.json`. The runner
loads all valid folders in sorted order. An invalid or outdated mod does not
stop the remaining folders.

```text
mods/
└── hide-codex-tool-hook-rows/
    ├── mod.json
    └── README.md
```

Mods are declarative. Each operation identifies one extension-relative file,
requires known markers, and performs a regular-expression replacement only
when the expected match count is exact. This intentionally makes patches fail
after incompatible extension updates instead of guessing against changed code.

The included Codex mod keeps `PreToolUse` and `PostToolUse` hooks running while
hiding their webview timeline rows.

## Safety behavior

- No mod runs arbitrary shell commands.
- Files are not changed until every marker and match-count check passes.
- Backups include the original file checksum.
- Restore refuses to overwrite a file changed after the mod was applied.
- Patch failures are logged and skipped.
- The default process exit code is zero; use `--strict` in CI to request a
  nonzero exit when any mod fails.
- VS Code is never launched, stopped, or reloaded by the runner.

VS Code and extension updates can replace modified files. Run `vscode-mods
apply` again after an update. If the compiled extension shape changed, the mod
will log a failure and leave the new version untouched until the manifest is
updated.

## Development

Requires [Bun](https://bun.sh/):

```sh
bun test
bun run check
bun run apply -- --dry-run
```

Release tags build standalone executables for macOS, Linux, and Windows. End
users do not need Bun or Node.js.

