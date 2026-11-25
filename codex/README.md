# Alabasta ↔ Codex

Codex's MCP, skill, and hook mechanisms mirror Claude Code's, so this reuses the
same MCP server (Alabasta's `/mcp`), resolution skill, and Stop hook — only the config format differs
(TOML + `~/.codex/`). The hook (`claude-plugin/hooks/stop.py`) and skill
(`claude-plugin/skills/task-resolution`) are agent-agnostic; they live under
`claude-plugin/` and are referenced here.

## Install

Replace `/PATH/TO/...`, `<deployment>`, and the API key first.

1. **MCP server + skill** — merge [`config.example.toml`](./config.example.toml) into
   `~/.codex/config.toml` (or `<repo>/.codex/config.toml`).
2. **Enforcement** — copy [`hooks.json`](./hooks.json) to `~/.codex/hooks.json`
   (user-level) or `<repo>/.codex/hooks.json` (project-level). Needs `python3`.
3. **Instructions (recommended)** — add this to your project's `AGENTS.md` so Codex
   reliably reaches for the tools even before the skill triggers:

   > When working an Alabasta task (a task id/identifier is given or
   > `ALABASTA_TASK_ID` is set), call `get_item` with the task before editing, and
   > submit a resolution with `submit_task_resolution` before finishing.
   > Never edit the task description or mark it done.

## Notes

- The Stop hook fires at turn end and returns `{"decision":"block","reason":...}`
  to force a resolution when code was edited for a linked task. It caps at two
  nudges and fails open, so it can never trap a session.
- Task linkage comes from `ALABASTA_TASK_ID` (set it, or use `alabasta work <TASK>
  --agent codex`) or a branch name containing an identifier.
- Codex's hook/skill config keys are newer than Claude Code's — if a key is
  rejected by your Codex version, check `learn.chatgpt.com/docs/config-file` and
  `.../hooks`, then adjust `config.example.toml`.
