#!/usr/bin/env node
// alabasta work <TASK> [--agent claude|codex] [--branch] [--print]
// Binds a coding-agent session to an Alabasta task: fetches the task, mints a run
// id, optionally creates a branch, exports ALABASTA_TASK_ID / ALABASTA_RUN_ID, and
// launches the agent. The installed plugin (skill + MCP + Stop hook) does the rest.
import { spawnSync } from "node:child_process";
import { AlabastaClient, configFromEnv } from "./client.js";

interface Args {
  task?: string;
  agent: "claude" | "codex";
  branch: boolean;
  print: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { agent: "claude", branch: false, print: false };
  const rest = [...argv];
  if (rest[0] === "work") rest.shift();
  while (rest.length) {
    const a = rest.shift()!;
    if (a === "--agent") {
      const v = rest.shift();
      if (v !== "claude" && v !== "codex") die(`--agent must be claude or codex`);
      args.agent = v;
    } else if (a === "--branch") args.branch = true;
    else if (a === "--print" || a === "--dry-run") args.print = true;
    else if (a.startsWith("-")) die(`Unknown flag: ${a}`);
    else if (!args.task) args.task = a;
    else die(`Unexpected argument: ${a}`);
  }
  return args;
}

function die(msg: string): never {
  console.error(`alabasta: ${msg}`);
  console.error(`\nUsage: alabasta work <TASK> [--agent claude|codex] [--branch] [--print]`);
  process.exit(1);
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

function runId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.task) die("a task id or identifier is required");

  const client = new AlabastaClient(configFromEnv());

  // Identifiers look like TOM-24; anything else is treated as a raw task id.
  const isIdentifier = /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(args.task);
  const task = await client.call<{
    taskId: string;
    identifier: string;
    title: string;
    status: string;
  }>("task.get", isIdentifier ? { identifier: args.task } : { taskId: args.task });

  const run = runId();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ALABASTA_TASK_ID: task.taskId,
    ALABASTA_RUN_ID: run,
  };

  console.error(`\n  ${task.identifier}  ${task.title}`);
  console.error(`  status ${task.status} · run ${run} · agent ${args.agent}\n`);

  if (args.branch) {
    const prefix = task.identifier.split("-")[0].toLowerCase();
    const branch = `${prefix}/${task.identifier}-${slugify(task.title)}`;
    const res = spawnSync("git", ["checkout", "-b", branch], { stdio: "inherit" });
    if (res.status !== 0) {
      console.error(`  (could not create branch ${branch} — continuing on current branch)`);
    }
  }

  const prompt =
    `You are working Alabasta task ${task.identifier}: "${task.title}". ` +
    `Call alabasta_get_task first, follow the task-resolution skill, and submit a ` +
    `structured resolution with alabasta_submit_task_resolution before finishing.`;

  if (args.print) {
    console.log(`export ALABASTA_TASK_ID=${task.taskId}`);
    console.log(`export ALABASTA_RUN_ID=${run}`);
    console.log(`${args.agent} ${JSON.stringify(prompt)}`);
    return;
  }

  const res = spawnSync(args.agent, [prompt], { stdio: "inherit", env });
  if (res.error) {
    const e = res.error as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      die(
        `'${args.agent}' not found on PATH. Install it, or run with --print to get the command and env.`,
      );
    }
    die(e.message);
  }
  process.exit(res.status ?? 0);
}

main().catch((err) => {
  console.error(`alabasta: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
