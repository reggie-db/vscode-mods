# Disable VS Code native chat

Sets the supported VS Code user setting `chat.disableAIFeatures` to `true`.
This disables VS Code's native AI/chat surfaces without patching the VS Code
application bundle or disabling the separately installed Codex extension.

The runner preserves comments and unrelated settings, writes atomically, and
records an exact backup for restore. If the settings file cannot be parsed or
written, it logs the failure and leaves the file untouched.
