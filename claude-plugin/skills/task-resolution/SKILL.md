---
name: task-resolution
description: How to work an Alabasta task and submit a structured resolution when done. Use whenever a coding session is tied to an Alabasta task — ALABASTA_TASK_ID is set, the user names an Alabasta task id/identifier (e.g. TOM-24), or the alabasta MCP tools are available.
---

# Alabasta task resolution

You are working a task tracked in Alabasta. When you finish, you must record **what
actually happened** as a structured resolution via the `alabasta_submit_task_resolution`
MCP tool. The resolution is the durable, human-reviewed record of the work — treat it as
part of "done", not an afterthought.

## Protocol

1. **Read the task first.** Call `alabasta_get_task` (by `ALABASTA_TASK_ID`, or the
   identifier the user gave) before editing. Understand the requirement and preserve its
   scope — do not silently expand or redefine it.
2. **Signal you've started** (optional): `alabasta_start_task_work` moves the task to *in
   progress*.
3. **Do the work.** Track, as you go, every file/symbol you materially change and every
   verification you run.
4. **Verify.** Run the relevant tests/build/lint. Be honest about what you did and did not
   run.
5. **Collect Git context.** Call `alabasta_collect_git_context` and merge its
   `diffStat` / `commits` / `checks` / `pullRequest` into the resolution payload — real diff
   stats, commits, PR state, and CI results beat hand-written summaries.
6. **Submit the resolution** with `alabasta_submit_task_resolution` before you finish.
7. If you **cannot** complete it, call `alabasta_report_blocker` with the reason instead.

You do **not** mark the task done and you do **not** edit the task description — submitting
moves the task to review, and a human accepts it. That boundary is intentional.

## What goes in the resolution

Fill the structured fields — the model fills the slots, Alabasta renders them:

- `outcome`: one of `implemented`, `partial`, `blocked`, `not_reproduced`, `no_change_required`.
- `summary`: 1–3 sentences on what changed and why. Operational, not conversational.
- `changes[]`: `{ path, symbol?, startLine?, endLine?, commitSha?, explanation }` per
  materially-changed location. Prefer `path` + `symbol` as the durable anchor; include
  `commitSha` when you cite line numbers (line numbers drift, commits don't).
- `verification[]`: `{ kind: test|build|lint|manual|deployment, command?, result:
  passed|failed|not_run, explanation? }`. One entry per check.
- `notVerified[]`: claims/behaviors you did **not** exercise. Be explicit — do not imply
  coverage you don't have.
- `limitations[]`: known constraints of the change.
- `deferred[]`: work you deliberately left for later.
- `references`: `{ branch?, commitSha?, pullRequest?, deployment? }`.
- `diffStat` / `commits` / `checks` / `pullRequest`: **do not write these by hand** — pass
  through whatever `alabasta_collect_git_context` returns (a snapshot at submit time).

If a launcher set `ALABASTA_RUN_ID`, it is used as `externalRunId` so resubmitting the same
run updates the same resolution instead of duplicating it. Bump `revision` for a new attempt.

## Rules

- **Distinguish verified from unverified.** A passed test is `verification`; an assumption is
  `notVerified`. Never present the second as the first.
- **Preserve the original scope.** Report extra work you did under `changes`, but the task's
  requirement is the human's, not yours to rewrite.
- **No conversational text.** The resolution is permanent documentation. Never include lines
  like "Want me to investigate the next issue?" or "Let me know if you'd like…". Those belong
  in the chat, not the record.
- **Be terse and factual.** Operational voice ("Keyed selection by id", "12 tests pass"), not
  marketing ("Successfully supercharged…").

## Worked example

```json
{
  "taskId": "…",
  "outcome": "implemented",
  "summary": "Duplicate note came from the selection reducer keying by array index; keyed by note id and deduped on load.",
  "changes": [
    { "path": "components/canvas/selection-reducer.ts", "symbol": "reduceSelection",
      "commitSha": "a1b2c3d", "startLine": 42, "endLine": 58,
      "explanation": "Key selection entries by note id, not array index." },
    { "path": "components/canvas/note-list.tsx",
      "explanation": "Dedupe notes by id before render." }
  ],
  "verification": [
    { "kind": "test", "command": "vitest run canvas", "result": "passed", "explanation": "12 selection tests pass" },
    { "kind": "lint", "result": "passed" },
    { "kind": "manual", "result": "not_run", "explanation": "Live canvas not exercised in this session" }
  ],
  "notVerified": ["Behavior with >50 overlapping notes"],
  "limitations": ["Only covers the note entity; other canvas entities untouched"],
  "deferred": ["Virtualize the note list for large boards"],
  "references": { "branch": "tom/TOM-24-fix-duplicate-note", "pullRequest": "https://github.com/org/repo/pull/999", "commitSha": "a1b2c3d" }
}
```
