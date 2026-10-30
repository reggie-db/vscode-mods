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
vscode-mods apply scope-codex-history-to-project
vscode-mods apply disable-vscode-native-chat
vscode-mods apply --dry-run
```

Use `--extensions-dir PATH` for a nonstandard or portable VS Code extension
directory. Set `VSCODE_EXTENSIONS_DIR`, `VSCODE_INSIDERS_EXTENSIONS_DIR`, or
`VSCODE_PORTABLE` to configure discovery without command flags.

Use `--settings-file PATH` for a nonstandard VS Code user settings file. Set
`VSCODE_SETTINGS_FILE` or `VSCODE_INSIDERS_SETTINGS_FILE` to configure one
without a command flag.

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

Mods are declarative. Extension operations identify one extension-relative
file, require known markers, and perform a regular-expression replacement only
when the expected match count is exact. User-settings operations set one JSONC
property while preserving the rest of the file. Extension patches intentionally
fail after incompatible updates instead of guessing against changed code.

### `disable-vscode-native-chat`

Disables VS Code's native AI and chat surfaces by setting the supported
`chat.disableAIFeatures` user setting to `true`. It preserves comments and
unrelated values in `settings.json` and does not modify the VS Code application
bundle or disable the separately installed Codex extension.

### `hide-codex-tool-hook-rows`

Keeps Codex `PreToolUse`, `PostToolUse`, and `UserPromptSubmit` hooks running
while hiding their timeline rows and removing the space those rows would have
occupied. The hidden hook types are defined in one list in the applied patch.

### `scope-codex-history-to-project`

Limits Codex history to conversations associated with the active VS Code
workspace roots. This applies consistently to the inline recent list, the
`View all` total, the full searchable history menu, sidebar history, and the
spinning in-progress counter. Codex-managed worktrees use Codex's existing
project grouping to map back to their source project. If the active project
cannot be resolved, the mod shows no history instead of falling back to global
history.

## Safety behavior

- No mod runs arbitrary shell commands.
- Files are not changed until every marker and match-count check passes.
- Backups include the original file checksum.
- Restore refuses to overwrite a file changed after the mod was applied.
- Patch failures are logged and skipped.
- User settings edits preserve JSONC comments and unrelated settings.
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

