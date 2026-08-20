import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./index.js", import.meta.url), "utf8");

test("standing context keeps legacy projectId and exposes Phase 1 scope inputs", () => {
  for (const field of ["productId", "projectId", "repo", "path"]) assert.match(source, new RegExp(`${field}:`));
  for (const target of ["agents_md", "claude_md", "brief_inline", "commit_msg", "pr_title", "repo_detect"]) assert.match(source, new RegExp(`\\"${target}\\"`));
});

// Regression: the resolution schema used to demand rulesApplied/rulesConflicted for
// any code change. In a workspace with no rules in scope that was unsatisfiable, and
// the only way through was to invent a rule id.
test("the resolution schema demands no rule citation", () => {
  assert.doesNotMatch(source, /rulesApplied/);
  assert.doesNotMatch(source, /rulesConflicted/);
  assert.match(source, /constraintExceptions/);
});

test("rule tools are opt-in", () => {
  assert.match(source, /ALABASTA_RULES_TOOLS/);
});
