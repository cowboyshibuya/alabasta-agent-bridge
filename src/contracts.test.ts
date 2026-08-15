import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("standing context keeps legacy projectId and exposes Phase 1 scope inputs", () => {
  const source = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  for (const field of ["productId", "projectId", "repo", "path"]) assert.match(source, new RegExp(`${field}:`));
  for (const target of ["agents_md", "claude_md", "brief_inline", "commit_msg", "pr_title", "repo_detect"]) assert.match(source, new RegExp(`\\"${target}\\"`));
});
