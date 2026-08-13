#!/usr/bin/env python3
"""Alabasta resolution enforcement — Claude Code Stop hook.

Blocks the agent from finishing a turn when: the session is tied to an Alabasta
task AND code was edited this session AND no resolution was submitted. It nudges
the model to call `alabasta_submit_task_resolution` (or report a blocker).

Deterministic backstop for the skill: instructions are followed most of the time,
this closes the gap on the times they aren't. Fails open — any error or ambiguity
allows the stop, so the hook can never trap a session.
"""
import json
import os
import re
import subprocess
import sys
import tempfile

# Edit-tool names that mean "touched code", matched case-insensitively so this
# works for Claude Code (Edit/Write/MultiEdit/NotebookEdit) and Codex
# (apply_patch). We deliberately exclude bare "shell"/"bash" — too broad (reads).
EDIT_TOOLS = {
    "edit", "write", "multiedit", "notebookedit", "update", "applypatch", "apply_patch",
}
# Match the resolution tool regardless of MCP namespacing
# (e.g. mcp__alabasta__alabasta_submit_task_resolution).
SUBMIT_RE = re.compile(r"submit_task_resolution")
BLOCKER_RE = re.compile(r"report_blocker")
IDENTIFIER_RE = re.compile(r"\b[A-Z][A-Z0-9]+-\d+\b")


def allow():
    sys.exit(0)


def block(reason: str):
    print(json.dumps({"decision": "block", "reason": reason}))
    sys.exit(0)


def linked_task(cwd: str):
    """Best-effort: env, then branch name. None => not an Alabasta session."""
    task_id = os.environ.get("ALABASTA_TASK_ID")
    if task_id:
        return task_id
    try:
        branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=cwd, capture_output=True, text=True, timeout=3,
        ).stdout.strip()
    except Exception:
        return None
    m = IDENTIFIER_RE.search(branch.upper())
    return m.group(0) if m else None


def iter_tool_names(transcript_path: str):
    """Yield every tool_use name in the transcript, tolerant of format drift."""
    try:
        with open(transcript_path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    # Fall back to substring detection on unparseable lines.
                    if SUBMIT_RE.search(line):
                        yield "submit_task_resolution"
                    continue
                yield from _walk(obj)
    except FileNotFoundError:
        return


def _walk(node):
    if isinstance(node, dict):
        # Claude uses {"type":"tool_use","name":...}; Codex uses function_call /
        # local_shell_call shapes, or a "tool_name" key. Treat a dict as a tool
        # call if it names one and carries input/arguments.
        name = node.get("name") or node.get("tool_name")
        looks_like_call = (
            str(node.get("type", "")).endswith(("tool_use", "call", "function"))
            or "input" in node
            or "arguments" in node
        )
        if isinstance(name, str) and looks_like_call:
            yield name
        for v in node.values():
            yield from _walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from _walk(v)


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        allow()

    # Never re-block a stop we already forced (belt: honor the flag if present).
    if payload.get("stop_hook_active"):
        allow()

    cwd = payload.get("cwd") or os.getcwd()
    transcript_path = payload.get("transcript_path")
    session_id = payload.get("session_id", "")

    task = linked_task(cwd)
    if not task or not transcript_path:
        allow()  # not an Alabasta-linked session

    edited = False
    submitted = False
    for name in iter_tool_names(transcript_path):
        if name.lower() in EDIT_TOOLS:
            edited = True
        if SUBMIT_RE.search(name) or BLOCKER_RE.search(name):
            submitted = True
    if not edited or submitted:
        allow()

    # Cap re-blocks per (session, task) so a stuck agent is never trapped.
    marker = os.path.join(
        tempfile.gettempdir(), f"alabasta-stop-{session_id}-{task}".replace("/", "_")
    )
    count = 0
    if os.path.exists(marker):
        try:
            count = int(open(marker).read().strip() or "0")
        except Exception:
            count = 0
    if count >= 2:
        allow()  # asked twice; don't nag further
    try:
        with open(marker, "w") as fh:
            fh.write(str(count + 1))
    except Exception:
        pass

    block(
        f"You edited code for Alabasta task {task} but haven't recorded a resolution. "
        "Before finishing, call alabasta_submit_task_resolution with the structured fields "
        "(outcome, summary, changes, verification, notVerified, limitations, deferred, "
        "references) — or alabasta_report_blocker if you couldn't complete it. "
        "Include rulesApplied when standing rules are in scope, and rulesConflicted for any "
        "you had to break. See the task-resolution skill for the format."
    )


if __name__ == "__main__":
    main()
