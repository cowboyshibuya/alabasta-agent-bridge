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

## Develop

```bash
bun install      # or npm install
npm run build    # tsc -> dist/
node dist/index.js
```

## Roadmap

Next: a shared resolution skill + Stop-hook enforcement, packaged as Claude Code
and Codex plugins, and an `alabasta work <TASK>` CLI launcher.
