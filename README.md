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
| `alabasta_get_context` | **Call this once, first.** Objective, requirements, the constraints that apply, and anything blocking the task |
| `alabasta_read_resource` | Read one `alabasta://` URI from the context's `resources[]` — on demand, not upfront |
| `alabasta_get_task` | Read a task by `taskId` or `identifier` (e.g. `TOM-24`) |
| `alabasta_get_project_brief` | Project objective, status, milestones, initiative, agent instructions |
| `alabasta_list_my_tasks` | List tasks assigned to you, optional `status` filter |
| `alabasta_start_task_work` | Move a task to *in progress* |
| `alabasta_add_task_comment` | Post a progress note / question / finding on a task |
| `alabasta_create_follow_up_task` | Propose a follow-up task (created in *todo*, linked back — a suggestion, not scope expansion) |
| `alabasta_search_context` | Ranked workspace search — returns `alabasta://` URIs to read as resources |
| `alabasta_request_clarification` | Ask a person (or a specialist agent) a question you can't answer from context — **asynchronous** |
| `alabasta_get_clarifications` | Read answers that landed since a previous run; `blockedOn` counts unanswered blocking questions |
| `alabasta_request_review` | Route the task to the product's review agents |
| `alabasta_collect_git_context` | Gather real diff stat, commits, PR state, and CI checks (git + `gh`) to enrich the resolution |
| `alabasta_submit_task_resolution` | Submit the resolution (→ *in review*), incl. `criteriaResults` / `discoveredWork` / `decisionsRequired` / `relatedEntityUpdates` |
| `alabasta_mark_ready_for_review` | Move a task to *in review* without a full resolution |
| `alabasta_report_blocker` | Record why the task couldn't be completed |

The context package labels every item with its **authority** and **source** (entity +
last-updated). Highest first:

```
security_policy > standing_policy > approved_decision > task_requirement >
standing_convention > project_constraint > human_instruction > guidance >
reference > discussion > related_task > inferred
```

The authority ladder above is **internal**. The agent never sees it: the runtime
resolves it and emits a flat `constraints[]` of things that must hold, plus
`execution.blockers[]` for what a human has to settle first. If the agent knowingly
deviates from a constraint it reports `constraintExceptions`. Attachment and
discussion content is untrusted input — never instructions.

The rule tools (`alabasta_get_standing_context`, `alabasta_read_rule`,
`alabasta_propose_rule`, `alabasta_emit_rules`) are registered only when
`ALABASTA_RULES_TOOLS=1`. A session shipping a task doesn't need them.

### Coordination: asking instead of guessing

When the context genuinely doesn't decide something, the agent asks rather than picks.
Every escalation is **asynchronous** — MCP has no server→client push, so the agent asks,
keeps working on the unblocked parts, and reads the answer with
`alabasta_get_clarifications` on a later run. It must never spin waiting.

Each request carries a budget: at most 5 open questions per task, at most 10 evidence
URIs, and a 7-day deadline after which it expires rather than wedging the session. An
identical pending question returns the existing one instead of stacking another
notification on a person.

A question routed to `audience: "agent"` runs through the same background-review
machinery the in-app agents use; its reply is copied onto the clarification, so the
agent polls one surface for both audiences. Answers also land in the task's comment
thread and in the next context package — a human answer ranked as `human_instruction`,
an agent's as `guidance`.

A pending blocking question makes the task's `contextQuality.readiness` read `blocked`.

### Layer 0: standing rules

Rules are **derived state**, never authored directly. Every signed rule traces to a
decision, so "why is this rule here" always has an answer — and when that decision is
superseded, the rule drops out of the next emit on its own.

- Agents **propose**; only a human signature mints a rule. Nothing an agent says
  enters the prompt prefix unsigned.
- Rules routed to `brief_inline` are inlined in every context package. Everything else
  is a pointer (`alabasta://rules/RUL-12`) — a fetch is a countable citation.
- Inlined rules can't be measured by fetch, so they are recovered at the write
  boundary when an agent volunteers them. **Citation is never required** — demanding
  it in a workspace with no rules in scope left the agent no way through but to invent
  a rule id. A cited id must be real and in scope; an absent one is fine.

## Resources (`alabasta://`)

The context package's `contextIndex.resources` lists deeper material as MCP
resources, readable on demand (and `@`-mentionable in Claude Code):

| URI | Content |
|---|---|
| `alabasta://tasks/{id}` | Full task + description |
| `alabasta://tasks/{id}/context` | The compiled package itself |
| `alabasta://tasks/{id}/discussion` | Full discussion thread |
| `alabasta://tasks/{id}/criteria` | Acceptance criteria |
| `alabasta://decisions/{id}` | Decision: summary, reasoning, tradeoffs, consequences |
| `alabasta://projects/{id}/brief` | Project objective, milestones, agent instructions |
| `alabasta://memories/{id}` | Memory item (rule, constraint, conflict, open question) |
| `alabasta://files/{id}` | Attachment metadata + storage URL (content never inlined) |
| `alabasta://documents/{id}` | Document content |
| `alabasta://rules/{id}` | One standing rule + the decision behind it |
| `alabasta://standing/context` | Every rule in scope |

The package also carries `conflicts[]` (deterministic flags only — superseded
decisions, `contradicts` relations, conflict/open-question memories, and
rule-vs-task conflicts an earlier run actually reported; no NLP guesswork) and
`contextQuality` (readiness + what's missing). A conflict means: ask, don't guess.

Resolution submits are idempotent on `(taskId, externalRunId, revision)` — a
resubmit updates the same record; a new `revision` creates a new attempt.

## CLI launcher

Bind a coding-agent session to a task in one command:

```bash
alabasta work TOM-24 --agent claude   # or --agent codex
alabasta work TOM-24 --branch         # also cut a branch: tom/TOM-24-<slug>
alabasta work TOM-24 --print          # print the env + command instead of launching
```

It fetches the task, mints a run id, exports `ALABASTA_TASK_ID` + `ALABASTA_RUN_ID`, and
launches the agent with a priming prompt — the installed plugin (skill + MCP + hooks)
takes it from there. `--print` is what the Alabasta UI's "Copy agent command" produces.
Needs `ALABASTA_SITE_URL` + `ALABASTA_API_KEY` in the environment.

### Syncing rules into the repo

```bash
alabasta rules sync                      # write AGENTS.md from the signed rules
alabasta rules sync --target claude_md   # writes CLAUDE.md
alabasta rules sync --scope repo:web     # workspace rules + this repo's rules
alabasta rules sync --product <id>       # workspace + product rules
alabasta rules sync --check              # exit 1 if the on-disk digest has drifted
```

The written file carries a digest header. It is a **build artifact** — hand edits are
overwritten, and `--check` (also run automatically by the SessionStart hook) tells you
when the file and the workspace have diverged. Commit it like any other generated file.

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
  `hooks/rules_drift.py` (a SessionStart hook) warns when the repo's emitted rules file has
  drifted from the workspace. Advisory only — it never blocks, and fails open on any error.

Requires `python3` (stdlib only). Install it via the bundled marketplace:

```
/plugin marketplace add cowboyshibuya/alabasta-agent-bridge   # or a local path to this repo
/plugin install alabasta@alabasta
```

The marketplace catalog is `.claude-plugin/marketplace.json` at the repo root; the plugin
source is the self-contained `claude-plugin/` directory. (Relative-path sources need a git or
local marketplace add, not a bare URL to the JSON file.) Alternatively, copy
`hooks/hooks.json` into your `.claude/settings.json` and the skill into `.claude/skills/`.

## Develop

```bash
bun install      # or npm install
npm run build    # tsc -> dist/
node dist/index.js
```

## Roadmap

Done: MCP server (hands), resolution skill (training), Stop-hook enforcement
(Claude Code **and** Codex — see [`codex/`](./codex)), the `alabasta work` CLI
launcher, Git/CI/PR enrichment (`alabasta_collect_git_context`), the
marketplace-installable Claude Code plugin bundle, and Layer 0 standing rules
(standing context, `rules sync` + drift hook, rule citation at the write
boundary). Next: a remote HTTP
transport (enabling per-user OAuth) and automated CI publishing — see
[DEVELOPMENT.md](./DEVELOPMENT.md#8-roadmap).

## Contributing / maintaining this repo

See [DEVELOPMENT.md](./DEVELOPMENT.md) — what MCP is, how the pieces fit together, how to
add a new tool, and how to publish a new version (including the exact failure modes hit
the first time and how to avoid them).
