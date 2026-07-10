# @alabasta/mcp

MCP server that connects coding agents (Claude Code, Codex, Cursor, …) to
[Alabasta](https://alabasta.io) tasks. The agent can read a task, start work, and
submit a **structured resolution** — what changed, verification, what's
unverified, deferred work, references — which a human reviews inside Alabasta.

It never overwrites the task description and never marks a task done: submitting a
resolution moves the task to **review**, and only a human Accept reaches **Done**.

This is a thin stdio adapter over Alabasta's `/agent/v1/*` HTTP API. The API key
encodes the workspace and principal, so that plus the site URL is all the config
it needs.

## Setup

1. In Alabasta, go to **Workspace settings → Agent access** and generate an API
   key (shown once).
2. Note your deployment's site URL — the `https://<deployment>.convex.site` value
   (`NEXT_PUBLIC_CONVEX_SITE_URL`).

### Claude Code

```bash
claude mcp add alabasta \
  --env ALABASTA_SITE_URL=https://<deployment>.convex.site \
  --env ALABASTA_API_KEY=alab_sk_... \
  -- npx -y @alabasta/mcp
```

### Codex / manual (`.mcp.json`)

```json
{
  "mcpServers": {
    "alabasta": {
      "command": "npx",
      "args": ["-y", "@alabasta/mcp"],
      "env": {
        "ALABASTA_SITE_URL": "https://<deployment>.convex.site",
        "ALABASTA_API_KEY": "alab_sk_..."
      }
    }
  }
}
```

### Environment

| Variable | Required | Purpose |
|---|---|---|
| `ALABASTA_SITE_URL` | yes | `https://<deployment>.convex.site` |
| `ALABASTA_API_KEY` | yes | Workspace API key (`alab_sk_...`) |
| `ALABASTA_TASK_ID` | no | Default task for this session (a launcher can export it, so tools work without a `taskId` argument) |
| `ALABASTA_RUN_ID` | no | Correlates a resolution to an agent run (used as `externalRunId` for idempotent resubmits) |

## Tools

| Tool | Does |
|---|---|
| `alabasta_get_task` | Read a task by `taskId` or `identifier` (e.g. `TOM-24`) |
| `alabasta_list_my_tasks` | List tasks assigned to you, optional `status` filter |
| `alabasta_start_task_work` | Move a task to *in progress* |
| `alabasta_submit_task_resolution` | Submit the structured resolution (→ *in review*) |
| `alabasta_mark_ready_for_review` | Move a task to *in review* without a full resolution |
| `alabasta_report_blocker` | Record why the task couldn't be completed |

Resolution submits are idempotent on `(taskId, externalRunId, revision)` — a
resubmit updates the same record; a new `revision` creates a new attempt.

## Claude Code plugin (skill + enforcement)

`claude-plugin/` bundles three layers so the feature is reliable, not just possible:

- **Hands** — `.mcp.json` wires the MCP server above (set `ALABASTA_SITE_URL` +
  `ALABASTA_API_KEY` in your env).
- **Training** — `skills/task-resolution/SKILL.md` teaches the agent the resolution
  protocol, format, and invariants (preserve scope; separate verified from unverified; no
  conversational text).
- **Enforcement** — `hooks/stop.py` (a Stop hook) blocks the agent from finishing when it
  edited code for a linked Alabasta task but never submitted a resolution. It nudges at most
  twice, then allows the stop, so it can never trap a session. Task linkage comes from
  `ALABASTA_TASK_ID` or a branch name containing an identifier (e.g. `tom/TOM-24-fix`).

Requires `python3` (stdlib only). Point Claude Code at the plugin directory, or copy
`hooks/hooks.json` into your `.claude/settings.json` and the skill into `.claude/skills/`.

## Develop

```bash
bun install      # or npm install
npm run build    # tsc -> dist/
node dist/index.js
```

## Roadmap

Done: MCP server (hands), resolution skill (training), Stop-hook enforcement
(Claude Code). Next: Codex plugin packaging and an `alabasta work <TASK>` CLI
launcher that fetches the task, creates a run, and exports
`ALABASTA_TASK_ID`/`ALABASTA_RUN_ID`.
