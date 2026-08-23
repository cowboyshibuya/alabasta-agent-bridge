# Changelog

## 0.7.1

- Annotate every MCP tool so clients can distinguish safe reads from additive and
  state-changing writes.
- Fail stalled Alabasta HTTP requests with an explicit error after 45 seconds.

## 0.7.0 — Context Runtime v2

Breaking. Requires an Alabasta backend serving the v2 context package.

- `alabasta_get_context_package` → **`alabasta_get_context`**, returning a working
  set (~300 tokens) instead of a full package (~2,500): objective, requirements,
  constraints, blockers, resources. Relevance-filtered — an authoritative but
  unrelated decision no longer ships.
- `contextQuality.readiness` is gone. **`execution.status`** (`ready` /
  `needs_clarification` / `blocked`) reports executability, not documentation
  completeness; missing criteria or discussion never block a run. Coverage is
  reported separately, as information.
- Only contradictions that intersect the task become blockers. Unrelated
  `open_question` memories no longer carry `ask_before_implementing`.
- New **`alabasta_read_resource`** — one tool for every `alabasta://` URI.
- Rule tools are opt-in behind `ALABASTA_RULES_TOOLS=1`.
- **`rulesApplied` / `rulesConflicted` removed from the resolution schema.** Rule
  citation is never required; an explicit `[]` no longer collapses to absent on the
  backend. `constraintExceptions` replaces `rulesConflicted`, and only for a
  deliberate deviation.

## 0.6.0

- Add product, project, repository, and path context to standing-rule reads and rule sync.
- Use the closed Phase 1 emit-target list while retaining `projectId` and `--scope` compatibility.
- Require both rule-reporting arrays for code-editing resolutions; `rulesApplied` must be non-empty.
- Document deterministic, versioned Standing Context emits.

Publishing remains a separate package-owner action.
