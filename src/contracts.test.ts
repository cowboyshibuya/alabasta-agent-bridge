import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { AlabastaClient } from "./client.js";

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

test("every tool advertises its MCP safety annotations", () => {
  const annotationValues = {
    READ_ONLY_TOOL: [true, false, true],
    ADDITIVE_TOOL: [false, false, false],
    STATE_CHANGING_TOOL: [false, true, false],
  } as const;
  for (const [name, [readOnly, destructive, idempotent]] of Object.entries(annotationValues)) {
    const declaration = source.match(new RegExp(`const ${name} = \\{([\\s\\S]*?)\\};`))?.[1];
    assert.ok(declaration, `${name} is declared`);
    assert.match(declaration, new RegExp(`readOnlyHint: ${readOnly}`));
    assert.match(declaration, new RegExp(`destructiveHint: ${destructive}`));
    assert.match(declaration, new RegExp(`idempotentHint: ${idempotent}`));
    assert.match(declaration, /openWorldHint: true/);
  }

  const expected = {
    alabasta_get_task: "READ_ONLY_TOOL",
    alabasta_get_context: "READ_ONLY_TOOL",
    alabasta_read_resource: "READ_ONLY_TOOL",
    alabasta_get_project_brief: "READ_ONLY_TOOL",
    alabasta_add_task_comment: "ADDITIVE_TOOL",
    alabasta_create_follow_up_task: "ADDITIVE_TOOL",
    alabasta_list_my_tasks: "READ_ONLY_TOOL",
    alabasta_start_task_work: "STATE_CHANGING_TOOL",
    alabasta_collect_git_context: "READ_ONLY_TOOL",
    alabasta_submit_task_resolution: "STATE_CHANGING_TOOL",
    alabasta_mark_ready_for_review: "STATE_CHANGING_TOOL",
    alabasta_report_blocker: "STATE_CHANGING_TOOL",
    alabasta_search_context: "READ_ONLY_TOOL",
    alabasta_request_clarification: "ADDITIVE_TOOL",
    alabasta_get_clarifications: "READ_ONLY_TOOL",
    alabasta_request_review: "ADDITIVE_TOOL",
    alabasta_get_standing_context: "READ_ONLY_TOOL",
    alabasta_read_rule: "READ_ONLY_TOOL",
    alabasta_propose_rule: "ADDITIVE_TOOL",
    alabasta_emit_rules: "READ_ONLY_TOOL",
  } as const;

  for (const [name, annotation] of Object.entries(expected)) {
    const start = source.search(new RegExp(`server\\.registerTool\\(\\s*"${name}"`));
    assert.notEqual(start, -1, `${name} is registered`);
    const next = source.indexOf("server.registerTool(", start + 1);
    const registration = source.slice(start, next === -1 ? undefined : next);
    assert.match(registration, new RegExp(`annotations: ${annotation}`), name);
  }
  assert.equal(source.match(/server\.registerTool\(/g)?.length, Object.keys(expected).length);
});

test("stalled Alabasta requests fail with an explicit timeout", async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = Object.getOwnPropertyDescriptor(AbortSignal, "timeout");
  Object.defineProperty(AbortSignal, "timeout", {
    configurable: true,
    value: () => {
      const controller = new AbortController();
      setImmediate(() => controller.abort(new DOMException("Timed out", "TimeoutError")));
      return controller.signal;
    },
  });
  globalThis.fetch = ((_input, init) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal;
      assert.ok(signal);
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    })) as typeof fetch;

  try {
    const client = new AlabastaClient({ siteUrl: "https://example.test", apiKey: "test" });
    await assert.rejects(
      client.call("task.get", { identifier: "TOM-153" }),
      /Alabasta request timed out after 45 seconds/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalTimeout) Object.defineProperty(AbortSignal, "timeout", originalTimeout);
  }
});
