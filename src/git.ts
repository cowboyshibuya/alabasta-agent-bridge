// Best-effort local Git + GitHub (`gh`) context collection. Every piece is
// wrapped so a missing tool, missing ref, or non-repo just omits that piece —
// enrichment is supplementary, never fatal.
import { execFileSync } from "node:child_process";

export interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  status?: string;
}
export interface DiffStat {
  filesChanged: number;
  additions: number;
  deletions: number;
  files: DiffFile[];
}
export interface Commit {
  sha: string;
  subject: string;
  author?: string;
  committedAt?: string;
}
export interface Check {
  name: string;
  status: string;
  conclusion?: string;
  url?: string;
}
export interface PullRequest {
  number?: number;
  state?: string;
  title?: string;
  url?: string;
}
export interface GitContext {
  branch?: string;
  headSha?: string;
  diffStat?: DiffStat;
  commits?: Commit[];
  checks?: Check[];
  pullRequest?: PullRequest;
}

function run(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 16 * 1024 * 1024,
    }).trim();
  } catch {
    return null;
  }
}

const git = (args: string[]) => run("git", args);

function resolveBase(baseRef: string | undefined): string | null {
  const candidates = [
    baseRef,
    "origin/HEAD",
    "origin/main",
    "origin/master",
    "main",
    "master",
    "HEAD~1",
  ].filter((x): x is string => !!x);
  for (const ref of candidates) {
    if (git(["rev-parse", "--verify", "--quiet", ref]) !== null) return ref;
  }
  return null;
}

function parseDiffStat(base: string): DiffStat | undefined {
  const out = git(["diff", "--numstat", `${base}...HEAD`]);
  if (!out) return undefined;
  const files: DiffFile[] = [];
  let additions = 0;
  let deletions = 0;
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const [a, d, ...rest] = line.split("\t");
    const path = rest.join("\t");
    if (!path) continue;
    const add = a === "-" ? 0 : parseInt(a, 10) || 0; // "-" = binary
    const del = d === "-" ? 0 : parseInt(d, 10) || 0;
    additions += add;
    deletions += del;
    files.push({ path, additions: add, deletions: del });
  }
  if (files.length === 0) return undefined;
  return { filesChanged: files.length, additions, deletions, files };
}

function parseCommits(base: string): Commit[] | undefined {
  // Unit-separator delimited so subjects with any punctuation are safe.
  const out = git(["log", `${base}..HEAD`, "--format=%H%x1f%s%x1f%an%x1f%aI"]);
  if (!out) return undefined;
  const commits: Commit[] = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const [sha, subject, author, committedAt] = line.split("\x1f");
    if (!sha) continue;
    commits.push({ sha, subject: subject ?? "", author, committedAt });
  }
  return commits.length ? commits : undefined;
}

function collectGh(): { pullRequest?: PullRequest; checks?: Check[] } {
  if (run("gh", ["--version"]) === null) return {};
  const out = run("gh", [
    "pr",
    "view",
    "--json",
    "number,state,title,url,statusCheckRollup",
  ]);
  if (!out) return {}; // no PR for this branch, or not a gh repo
  let data: {
    number?: number;
    state?: string;
    title?: string;
    url?: string;
    statusCheckRollup?: Array<Record<string, unknown>>;
  };
  try {
    data = JSON.parse(out);
  } catch {
    return {};
  }
  const pullRequest: PullRequest = {
    number: typeof data.number === "number" ? data.number : undefined,
    state: data.state ? String(data.state).toLowerCase() : undefined,
    title: data.title,
    url: data.url,
  };
  const rollup = Array.isArray(data.statusCheckRollup) ? data.statusCheckRollup : [];
  const checks: Check[] = rollup.map((r) => ({
    name: String(r.name ?? r.context ?? "check"),
    status: String(r.status ?? r.state ?? "").toLowerCase(),
    conclusion: r.conclusion
      ? String(r.conclusion).toLowerCase()
      : r.state
        ? String(r.state).toLowerCase()
        : undefined,
    url: (r.detailsUrl as string) ?? (r.targetUrl as string) ?? undefined,
  }));
  return { pullRequest, checks: checks.length ? checks : undefined };
}

export function collectGitContext(baseRef?: string): GitContext {
  const headSha = git(["rev-parse", "HEAD"]) ?? undefined;
  if (!headSha) return {}; // not a git repo
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]) ?? undefined;
  const base = resolveBase(baseRef);
  const ctx: GitContext = { headSha, branch };
  if (base) {
    ctx.diffStat = parseDiffStat(base);
    ctx.commits = parseCommits(base);
  }
  const { pullRequest, checks } = collectGh();
  if (pullRequest) ctx.pullRequest = pullRequest;
  if (checks) ctx.checks = checks;
  return ctx;
}
