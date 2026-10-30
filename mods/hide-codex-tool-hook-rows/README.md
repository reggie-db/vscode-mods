# Hide Codex tool hook rows

This mod changes only the Codex webview renderer. `PreToolUse` and
`PostToolUse` hooks continue to execute, but their timeline entries are
filtered out before React creates the row. This removes both the hook content
and the spacing that the surrounding timeline would otherwise reserve for it.

The patch is deliberately version-sensitive. It requires the known Codex hook
component markers and exactly one matching compiled component shape. When an
extension update changes either one, the runner logs a failure and leaves the
extension untouched.

Reload the VS Code window after applying or restoring the mod.
