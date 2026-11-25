---
name: task-resolution
description: How to work an Alabasta task and submit a structured resolution when done. Use whenever a coding session is tied to an Alabasta task — ALABASTA_TASK_ID is set, the user names an Alabasta task identifier (e.g. TOM-24), or the alabasta MCP tools are available.
---

# Alabasta task resolution

You are working a task tracked in Alabasta. When you finish, record **what actually
happened** as a structured resolution with the `submit_task_resolution` tool. The
resolution is the human-reviewed record of the work: it is part of "done", not an
afterthought.

## Protocol

1. **Read the task once.** Call `get_item` with the identifier (`ALABASTA_TASK_ID`, or the
   one the user gave) before editing. You get its description, status, project, comments
   and resolutions. If it belongs to a project, `get_project_brief` gives the project's
   goal, its other tasks and its documents. Documents and mentions are `alabasta://` links;
   `get_item` follows them.
2. **Signal you've started** (optional): `start_task_work` moves the task to *in progress*.
3. **Do the work.** Track every file and symbol you materially change and every check you
   run.
4. **Ask rather than guess.** When the context doesn't decide something that matters
   (sources contradict, a requirement is ambiguous), call `request_clarification` with the
   question instead of picking, and stop work on that part. The answer arrives as a reply
   on the task; read it with `get_item` on a later run. Continue with the parts that
   aren't blocked.
5. **Stay in scope.** If you find a related bug or improvement, don't fix it: create a
   follow-up with `create_task`, or list it under `deferred` in the resolution. Progress
   notes for the team go through `add_comment`.
6. **Verify.** Run the relevant tests, build and lint. Be honest about what you did and
   did not run.
7. **Gather the Git references yourself** (`git rev-parse --abbrev-ref HEAD`,
   `git rev-parse HEAD`, the pull request URL if there is one) for `references`.
8. **Submit the resolution** with `submit_task_resolution` before you finish.
9. If you **cannot** complete it, call `report_blocker` with the reason instead.

You do **not** mark the task done and you do **not** edit the task description; Alabasta
refuses both. Submitting moves the task to review, and a person accepts it or returns it
with a note.

## The resolution

| Field | What goes in it |
|---|---|
| `id` | The task identifier, e.g. `TOM-24`. |
| `outcome` | `implemented`, `partial`, `blocked`, `not_reproduced` or `no_change_required`. |
| `summary` | What you did, in a few sentences a reviewer can trust. |
| `changes[]` | `{ path, symbol?, explanation }` for each material change. |
| `verification[]` | `{ kind, command?, result, explanation? }`; `kind` is test, build, lint, manual or deployment; `result` is passed, failed or not_run. |
| `notVerified[]` | What you could not check. The reviewer reads this first, so be honest. |
| `deferred[]` | Work you left for later. |
| `references` | `{ branch?, commitSha?, pullRequest? }`. |

A resolution that admits what wasn't verified is worth more than one that claims
everything passed.
