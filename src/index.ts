#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AlabastaClient, configFromEnv } from "./client.js";

// A default task hint the CLI launcher can export so the agent knows its
// assignment without being told (correlation via env).
const DEFAULT_TASK_ID = process.env.ALABASTA_TASK_ID;

const changeSchema = z.object({
  path: z.string().describe("Repo-relative file path that changed"),
  symbol: z.string().optional().describe("Function/class/symbol changed"),
  startLine: z.number().optional(),
  endLine: z.number().optional(),
  commitSha: z
    .string()
    .optional()
    .describe("Commit the line range refers to (line numbers are a snapshot)"),
  explanation: z.string().describe("What changed here and why"),
});

const verificationSchema = z.object({
  kind: z.enum(["test", "build", "lint", "manual", "deployment"]),
  command: z.string().optional(),
  result: z.enum(["passed", "failed", "not_run"]),
  explanation: z.string().optional(),
});

const referencesSchema = z
  .object({
    branch: z.string().optional(),
    commitSha: z.string().optional(),
    pullRequest: z.string().optional(),
    deployment: z.string().optional(),
  })
  .default({});

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [{ type: "text" as const, text: `Error: ${message}` }],
  };
}

async function main() {
  const client = new AlabastaClient(configFromEnv());
  const server = new McpServer({ name: "alabasta", version: "0.1.0" });

  server.registerTool(
    "alabasta_get_task",
    {
      title: "Get Alabasta task",
      description:
        "Read an Alabasta task (title, description, status, priority) before editing. Pass taskId or identifier (e.g. TOM-24).",
      inputSchema: {
        taskId: z.string().optional(),
        identifier: z.string().optional(),
      },
    },
    async ({ taskId, identifier }) => {
      try {
        const id = taskId ?? DEFAULT_TASK_ID;
        return ok(await client.call("task.get", { taskId: id, identifier }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "alabasta_list_my_tasks",
    {
      title: "List my Alabasta tasks",
      description: "List tasks assigned to you, optionally filtered by status.",
      inputSchema: { status: z.string().optional() },
    },
    async ({ status }) => {
      try {
        return ok(await client.call("tasks.listMine", { status }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "alabasta_start_task_work",
    {
      title: "Start work on a task",
      description: "Mark a task in progress before you begin editing.",
      inputSchema: { taskId: z.string().optional() },
    },
    async ({ taskId }) => {
      try {
        return ok(await client.call("task.startWork", { taskId: taskId ?? DEFAULT_TASK_ID }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "alabasta_submit_task_resolution",
    {
      title: "Submit task resolution",
      description:
        "Submit a STRUCTURED resolution after completing work. Moves the task to review for a human to accept — it never marks the task done and never edits the task description. Distinguish verified from unverified claims. Do not include conversational prompts.",
      inputSchema: {
        taskId: z.string().optional(),
        outcome: z.enum([
          "implemented",
          "partial",
          "blocked",
          "not_reproduced",
          "no_change_required",
        ]),
        summary: z.string(),
        changes: z.array(changeSchema).default([]),
        verification: z.array(verificationSchema).default([]),
        notVerified: z.array(z.string()).default([]),
        limitations: z.array(z.string()).default([]),
        deferred: z.array(z.string()).default([]),
        references: referencesSchema,
        externalRunId: z.string().optional(),
        revision: z.number().optional(),
        provider: z.string().optional(),
        client: z.string().optional(),
        model: z.string().optional(),
        sessionId: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const taskId = args.taskId ?? DEFAULT_TASK_ID;
        return ok(
          await client.call("task.submitResolution", {
            ...args,
            taskId,
            externalRunId: args.externalRunId ?? process.env.ALABASTA_RUN_ID,
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "alabasta_mark_ready_for_review",
    {
      title: "Mark task ready for review",
      description: "Move a task into review without submitting a full resolution.",
      inputSchema: { taskId: z.string().optional() },
    },
    async ({ taskId }) => {
      try {
        return ok(
          await client.call("task.markReadyForReview", {
            taskId: taskId ?? DEFAULT_TASK_ID,
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "alabasta_report_blocker",
    {
      title: "Report a blocker",
      description: "Record why the task could not be completed, for a human to triage.",
      inputSchema: { taskId: z.string().optional(), reason: z.string() },
    },
    async ({ taskId, reason }) => {
      try {
        return ok(
          await client.call("task.reportBlocker", {
            taskId: taskId ?? DEFAULT_TASK_ID,
            reason,
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio is the protocol channel; log to stderr only.
  console.error("alabasta-mcp ready");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
