# Scope Codex history to the active project

Limits Codex history surfaces in the VS Code extension to conversations that
Codex can associate with the currently open VS Code workspace roots.

This covers the inline recent list, its `View all` total, the full searchable
history menu, sidebar history, and the spinning in-progress counter. It uses
Codex's existing project and worktree grouping so managed worktrees can map
back to their source project.

If active workspace roots or project grouping are unavailable, the mod shows
no historical tasks. It does not fall back to global history.
