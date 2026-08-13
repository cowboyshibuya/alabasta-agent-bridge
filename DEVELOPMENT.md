# Alabasta Agent Bridge — Development Guide

Maintainer-facing reference for this repo: what MCP is, how the bridge is built, how to
change it, how to add a new tool, and how to publish. (For end-user setup, see
[README.md](./README.md) or the in-app [`/help`](https://alabasta.io/help) guide.)

---

## 1. What is MCP?

**MCP (Model Context Protocol)** is an open, JSON-RPC-based protocol that lets an AI agent
(Claude Code, Codex, Cursor, …) talk to an external system through a small, typed set of
**tools** — named, schema-validated functions the agent can call, like `alabasta_get_task`.

An MCP **server** is any process that speaks this protocol. It advertises a list of tools
(name, description, input schema) over a transport, and the agent's host application (Claude
Code, Codex, …) calls them on the model's behalf when it decides a tool is relevant. Two
common transports:

- **stdio** — the host spawns the server as a child process and talks JSON-RPC over its
  stdin/stdout. Simple, zero-hosting, works for local tools. **This is what
  `@alabasta/mcp` uses.**
- **Streamable HTTP** — a server you host yourself; the agent connects over HTTP/SSE.
  Enables remote servers and OAuth. Not used here (yet) — see [§8](#8-roadmap).

The protocol handshake is always: `initialize` → `notifications/initialized` → then any
number of `tools/list` / `tools/call` messages. You never need to hand-roll this — the
`@modelcontextprotocol/sdk` package (used in `src/index.ts`) implements it; you only
register tools and their handlers.

Why this matters for Alabasta: MCP is the **hands** layer of the three-layer model this repo
implements (hands / training / enforcement — see the root [`docs/agent-resolution.md`](../alabasta-beta/docs/agent-resolution.md)
in the main app repo for the full product picture). This repo is *only* the hands, plus the
CLI launcher and the packaging that bundles training (skill) and enforcement (Stop hook)
around it.

---

## 2. How this repo works

```
src/
  client.ts   — AlabastaClient: thin fetch wrapper over Alabasta's /agent/v1/* HTTP API
  index.ts    — the MCP server itself: registers tools, wires each to an HTTP call
  git.ts      — collectGitContext(): local git/gh introspection (no network beyond gh)
  cli.ts      — `alabasta work <TASK>` launcher + `alabasta rules sync` (a separate bin, not MCP tools)

claude-plugin/         — Claude Code plugin: bundles the MCP config + skill + hooks
  .claude-plugin/plugin.json
  .mcp.json             — tells Claude Code how to launch the server (npx -y @alabasta/mcp)
  skills/task-resolution/SKILL.md
  hooks/{hooks.json,stop.py,rules_drift.py}

codex/                  — same skill + hooks, Codex's TOML config format instead of plugin.json
.claude-plugin/marketplace.json  — makes claude-plugin/ installable via `/plugin marketplace add`
```

**Data flow for a tool call:**

```
Claude Code / Codex
   │ JSON-RPC over stdio
   ▼
src/index.ts (McpServer, registerTool per tool)
   │ calls client.call(path, body)
   ▼
src/client.ts (AlabastaClient)
   │ POST https://<deployment>.convex.site/agent/v1/<path>
   │ Authorization: Bearer <ALABASTA_API_KEY>
   ▼
alabasta-beta: convex/http.ts → convex/agentResolution.ts (internal Convex functions)
```

The server itself holds **no business logic** — every tool is a schema + a pass-through
`client.call(...)` to the corresponding `/agent/v1/*` endpoint in the main app
(`alabasta-beta/convex/http.ts`). This repo's job is *only*: expose that HTTP API as MCP
tools, plus local-machine conveniences (`alabasta_collect_git_context`, the CLI) that
genuinely need to run on the developer's machine rather than in Convex.

**Config is two env vars**, resolved once in `configFromEnv()` (`src/client.ts:43`):

| Var | Required | Notes |
|---|---|---|
| `ALABASTA_SITE_URL` | yes | `https://<deployment>.convex.site` |
| `ALABASTA_API_KEY` | yes | `alab_sk_…`, minted in Alabasta → Workspace settings → Agent access |
| `ALABASTA_TASK_ID` | no | Read directly in `index.ts` as `DEFAULT_TASK_ID`, used when a tool call omits `taskId` |
| `ALABASTA_RUN_ID` | no | Read directly when submitting a resolution, for idempotent resubmits |

**Two `bin` entries, deliberately named around npx's resolution rule** (`package.json`):

```json
"bin": { "mcp": "dist/index.js", "alabasta": "dist/cli.js" }
```

`npx -y @alabasta/mcp` (no explicit command) only resolves unambiguously when either there's
a single `bin` entry, or one entry's key matches the **unscoped package name** — here that's
`mcp` (from `@alabasta/mcp`). That's why the server's bin key is `mcp`, not `alabasta-mcp`.
See [§7](#7-troubleshooting--lessons-learned) — this exact mismatch broke every install until
it was fixed in `0.1.1`. The `alabasta` bin (the CLI) is unaffected and used after a global
install (`npm i -g @alabasta/mcp`) or via `npx --package=@alabasta/mcp alabasta work …`.

---

## 3. Local development

Toolchain: **bun** for installing/building, plain **Node** for running (the compiled output
is CommonJS-free ESM JS with a `#!/usr/bin/env node` shebang — that's what npx/npm actually
execute).

```bash
bun install                                    # install deps
bun --bun ./node_modules/typescript/bin/tsc    # compile src/ → dist/ (or: npm run build)
```

Run the server directly against a real deployment (no publish needed — this is exactly what
the plugin does once published, just pointed at your local build):

```bash
ALABASTA_SITE_URL=https://<deployment>.convex.site \
ALABASTA_API_KEY=alab_sk_... \
node dist/index.js
```

It prints `alabasta-mcp ready` on stderr and then waits on stdin for JSON-RPC. To exercise it
without a real MCP client, pipe a handshake + a tool call in by hand:

```bash
{
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"dev","version":"0"}}}'
  sleep 0.3
  echo '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"alabasta_get_task","arguments":{"identifier":"TOM-24"}}}'
  sleep 1
} | ALABASTA_SITE_URL=... ALABASTA_API_KEY=... node dist/index.js
```

This round-trips through the real handshake and the real HTTP call — it's the same technique
used to verify every change in this repo before it ships (no test framework wired up yet;
this manual stdio check plus a live `alabasta-beta` deployment is the verification loop).

**Point a locally-installed plugin at your local build** instead of the published package
(useful while developing a new tool): edit the installed
`~/.claude/plugins/cache/alabasta/alabasta/<version>/.mcp.json` (or your project's
`.mcp.json`) to run `node` against your absolute `dist/index.js` path instead of
`npx -y @alabasta/mcp`, restart Claude Code, and the plugin will use your unpublished code.
Revert before publishing so the shipped config keeps using the npm package.

---

## 4. Adding a new MCP tool

Every tool follows the same shape in `src/index.ts` — copy the pattern of an existing one
(`alabasta_mark_ready_for_review` is the shortest). Steps:

1. **Does it need a new backend endpoint?** Most tools are a thin wrapper over an
   `/agent/v1/*` route in `alabasta-beta`. If the capability doesn't exist there yet, add it
   first: a route in `convex/http.ts`, an internal Convex function in
   `convex/agentResolution.ts` (or wherever fits), validated input, and — if it accepts
   free-form data from the agent — parsing at the trust boundary (see
   `lib/agent-resolution.ts`'s `parseResolutionInput` for the pattern: never trust the HTTP
   body directly).
2. **Define the input schema with zod**, next to the other schemas near the top of
   `src/index.ts`. Reuse existing ones (`changeSchema`, `verificationSchema`, …) where the
   shape matches — don't redefine.
3. **Register the tool:**
   ```ts
   server.registerTool(
     "alabasta_your_tool_name",
     {
       title: "Human-readable title",
       description: "What it does and WHEN the agent should call it — this is the only thing the model sees to decide relevance, so be specific and directive.",
       inputSchema: { /* zod fields, or z.object(...).shape */ },
     },
     async (args) => {
       try {
         return ok(await client.call("your.endpoint.path", { ...args, taskId: args.taskId ?? DEFAULT_TASK_ID }));
       } catch (e) {
         return fail(e);
       }
     },
   );
   ```
   `ok()`/`fail()` (top of the file) are the two response shapes every tool must return —
   never throw past the handler; MCP surfaces `fail()`'s `isError: true` to the model as a
   normal tool result, not a protocol error.
4. **Naming:** prefix every tool `alabasta_` — it's how the Stop hook
   (`claude-plugin/hooks/stop.py`) and the resolution skill recognize "this is our tool" in a
   transcript that also contains the host's built-in tools (`Edit`, `Write`, …).
5. **Update the skill** (`claude-plugin/skills/task-resolution/SKILL.md`) if the new tool
   changes the protocol an agent should follow (e.g. a new required step before submitting).
6. **Update `README.md`'s tool table** — it's the single source users read to know what's
   available.
7. **Rebuild, smoke-test with the manual stdio pipe above**, then bump the version and
   publish (§6).

If the tool is a **local-machine capability** (like `alabasta_collect_git_context` — it shells
out to `git`/`gh`, not to Alabasta), put the logic in its own module (`src/git.ts` is the
model: small, pure functions, everything wrapped so a missing tool/ref just omits that piece
rather than throwing) and have `index.ts` call it directly instead of going through
`client.call`.

---

## 5. Updating the CLI, skill, or hooks

- **CLI (`src/cli.ts`)** — a second `bin` entry, not an MCP tool. It only talks to Alabasta via
  `AlabastaClient` (same as the server) to fetch the task, then `spawnSync`s the agent binary
  with a priming prompt and the two correlation env vars set. Add flags in `parseArgs`; keep
  it a thin launcher — real behavior belongs in the skill/hook, not here.
  `alabasta rules sync` is the second subcommand: it POSTs `rules.emit` and writes the
  returned content to disk. The digest lives in the file's header comment; `--check` parses
  it back out and compares. Keep the rendering server-side — the CLI must never assemble a
  rules file itself, or the digest stops meaning "this came from the workspace".
- **Skill (`claude-plugin/skills/task-resolution/SKILL.md`)** — plain markdown the agent reads
  as instructions. Edit directly; no build step. Keep the "worked example" JSON block in sync
  with the actual `alabasta_submit_task_resolution` schema in `index.ts`.
- **Stop hook (`claude-plugin/hooks/stop.py`)** — stdlib-only Python, deliberately
  dependency-free (it must run inside any environment python3 exists, with no `pip install`
  step). If you touch its transcript-parsing logic (`iter_tool_names`, `_walk`), re-verify
  against **both** Claude's `tool_use` shape and Codex's `function_call`/`apply_patch` shape —
  it's intentionally agent-agnostic, and it's easy to silently break one while fixing the
  other. Test by piping a synthetic hook-input JSON at it directly:
  ```bash
  echo '{"cwd":"'"$(pwd)"'","session_id":"test","transcript_path":"/path/to/fake.jsonl"}' \
    | ALABASTA_TASK_ID=TOM-1 python3 claude-plugin/hooks/stop.py
  ```
  No output + exit 0 = allow. JSON `{"decision":"block",...}` on stdout = block. It fails
  open on any error by design — never make it fail closed.
- **Rules drift hook (`claude-plugin/hooks/rules_drift.py`)** — a SessionStart hook, same
  stdlib-only discipline. It POSTs `rules.emit`, compares the returned digest with the one in
  the repo's `AGENTS.md` header, and prints a warning on mismatch. It **never** blocks and
  always exits 0: a rules check is not worth trapping work over, and a workspace with no
  credentials in the env must degrade to silence, not noise. Test it the same way:
  ```bash
  echo '{"cwd":"'"$(pwd)"'"}' | ALABASTA_SITE_URL=… ALABASTA_API_KEY=… \
    python3 claude-plugin/hooks/rules_drift.py
  ```
  Override the file it checks with `ALABASTA_RULES_TARGET` / `ALABASTA_RULES_SCOPE`.
- **Codex packaging (`codex/`)** — mirrors the Claude plugin but in Codex's format
  (`config.toml` + `hooks.json`). It references the **same** `claude-plugin/hooks/*.py` and
  `claude-plugin/skills/task-resolution/` — there is deliberately only one copy of each; don't
  fork them per-agent.

After any change to `claude-plugin/` or `.claude-plugin/marketplace.json`, bump the version in
**both** `claude-plugin/.claude-plugin/plugin.json` and the entry in
`.claude-plugin/marketplace.json` (they're independent of the npm package's version — the
plugin can ship a hook/skill fix without touching the MCP server at all). Existing installs
pick it up via `/plugin marketplace update` in Claude Code.

---

## 6. Publishing to npm

The published artifact is **only `dist/`** (see `"files": ["dist"]` in `package.json`) — the
plugin's `.mcp.json` runs `npx -y @alabasta/mcp`, which always fetches the current `latest`
tag from the registry, so a publish is required for any server-side change to reach installed
plugins (unlike the skill/hooks, which are read live from the marketplace repo).

```bash
cd alabasta-agent-bridge
# 1. bump the version — npm versions are immutable, you cannot republish 0.1.1
#    edit package.json's "version", or: npm version patch|minor|major
# 2. rebuild
bun --bun ./node_modules/typescript/bin/tsc
# 3. publish (scoped package, must be explicitly public)
bun publish --access public   # or: npm publish --access public
```

Publishing needs:
- You logged in (`npm whoami`) and, if 2FA is enabled on your account (it should be),
  approval via the browser link `bun`/`npm publish` prints, or a typed OTP — always done by
  you, directly, in your own terminal. Never pass a token or OTP through an agent.
- **Ownership of the `@alabasta` npm org.** This is a *scoped* package; publishing the first
  version under an unclaimed scope requires the scope to exist as an npm organization you're
  a member of (Create at npmjs.com → your avatar → **Add Organization**, free tier). Check
  with `npm org ls alabasta` — it should list your account as a member/owner, not 404.

**Verify the publish actually works** — don't just trust the "published" message; test the
exact command every plugin runs, from a clean fetch:

```bash
npm view @alabasta/mcp version   # confirms the registry has it
npx -y @alabasta/mcp@<version>   # should print "alabasta-mcp ready" on stderr and hang on stdin
                                  # (Ctrl-C to exit — hanging is correct, it's waiting for JSON-RPC)
```

If that fails with `could not determine executable to run`, see [§7](#7-troubleshooting--lessons-learned) —
it's the bin-name issue, not a fresh bug.

---

## 7. Troubleshooting / lessons learned

These are real failures hit while first shipping this package — recorded so nobody re-derives
them:

**`npx -y @alabasta/mcp` → `404 Not Found`**
The package was never published, or you're testing a version that failed to publish. Check
`npm view @alabasta/mcp version`. Publish per §6.

**`npm publish` → `403 ... Two-factor authentication ... required`**
Normal — npm requires 2FA approval for every publish by default. Not a bug; run the publish
command yourself and approve via the browser link or OTP prompt it shows. This cannot be
scripted around, and shouldn't be — 2FA-on-publish is exactly the protection you want for a
package other people's agents will `npx` and run.

**`npm publish` → `404 Not Found ... '@alabasta/mcp@x.y.z' does not exist in this registry`**
This is npm's (confusing) way of saying **you don't have publish rights to this scope** —
it returns 404 instead of 403 here so it doesn't leak whether the scope belongs to someone
else. Fix: create the `alabasta` npm organization (§6) so the scope exists and you're a
member, then retry.

**Every install fails with `npm error could not determine executable to run` (after a
successful publish)**
This is an npx bin-resolution ambiguity, not an auth or network problem. `npx <pkg>` with no
explicit command only auto-picks a binary when there's exactly one `bin` entry, or one entry's
key equals the package's **unscoped** name. This package originally had
`{ "alabasta-mcp": ..., "alabasta": ... }` — neither key matched `mcp` (from `@alabasta/mcp`),
so npx couldn't choose. Fixed in `0.1.1` by renaming the server's bin key to `mcp`. If you ever
add a third `bin` entry, re-verify `npx -y @alabasta/mcp` (no arguments) still resolves
unambiguously — add one, and it may break again.

**A GitHub repo/marketplace-source typo silently breaks `/plugin marketplace add`**
The repo was briefly named `alabasta-agent-bride` (typo) while every doc referenced
`alabasta-agent-bridge`. `gh repo rename` fixed it at the source (GitHub keeps a redirect from
the old name) rather than editing every doc to match the typo. If you ever rename this repo
again, update the local git remote (`git remote set-url origin …`) even though the redirect
means it isn't strictly required.

---

## 8. Roadmap

Built: the **Context Runtime Phase 1** surface — `alabasta_get_context_package`
(compiled, authority-ranked task brief with provenance), `alabasta_get_project_brief`,
`alabasta_add_task_comment`, `alabasta_create_follow_up_task`, and the extended
completion contract on `alabasta_submit_task_resolution` (`criteriaResults`,
`discoveredWork`, `decisionsRequired`, `relatedEntityUpdates`). The compiler lives in
`alabasta-beta/convex/contextRuntime.ts`; these tools are thin pass-throughs.

Built: **Context Runtime Phase 2** — `alabasta://` MCP resources (task, context,
discussion, criteria, decision, project brief, memory, file, document) backed by the
backend's `resource.read`, `alabasta_search_context` (ranked keyword search returning
resource URIs), a resource-menu `contextIndex`, deterministic `conflicts[]`, and the
`contextQuality` score in every package.

Built: **Layer 0 — standing context** — `alabasta_get_standing_context`,
`alabasta_read_rule`, `alabasta_propose_rule`, `alabasta_emit_rules`, the
`alabasta://rules/{id}` + `alabasta://standing/context` resources, the
`alabasta rules sync [--check]` CLI, the `rules_drift.py` SessionStart hook, and
`rulesApplied` / `rulesConflicted` on the resolution. Rules are derived state signed
by humans in Alabasta (**Workspace settings → Rules**); the backend lives in
`alabasta-beta/convex/rules.ts` and `alabasta-beta/lib/rules-emit.ts`.

Not yet built, in rough priority order:
- **Context Runtime Phase 3** — clarification workflows (MCP elicitation + async
  human questions), review routing, agent consultation, connection scoping.
- **Rule scope inheritance** — `repo`/`path` rules currently reach agents only via the
  emitted file; resolving them per-session needs the agent to declare its repo.
- **Vector search** — embeddings over summaries/memories/decisions; add when the
  keyword ranking in `contextSearch.ts` measurably fails.
- **Remote HTTP (Streamable) transport** — a hosted server instead of stdio, enabling OAuth
  per-user identity instead of a static workspace API key. The bigger architectural move; see
  the "recommended architecture" discussion in `alabasta-beta/docs/agent-resolution.md`.
- **Automated CI publish** — a GitHub Action that bumps version + publishes on tag push, so
  releases don't depend on a human running `bun publish` locally (still needs 2FA handling —
  likely a granular automation token with 2FA bypass, configured once).
- **Tests** — currently verified by hand (manual stdio pipes + a live dev deployment). A
  thin test harness that stubs `AlabastaClient` and asserts each tool's `ok()`/`fail()` shape
  would catch regressions without needing a live backend.
