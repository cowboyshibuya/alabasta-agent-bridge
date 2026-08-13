#!/usr/bin/env python3
"""Alabasta rules drift check — SessionStart hook.

Compares the digest in the repo's emitted rules file (AGENTS.md by default)
against the workspace's current digest, and prints a warning when they differ.
The repo file is a build artifact: Alabasta is the compiler, so a mismatch means
the file was hand-edited or the rules moved on.

Advisory only — never blocks a session, and fails open on any error (no
credentials, no network, no file). A rules check is not worth trapping work over.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request

DIGEST_RE = re.compile(r"<!--\s*Alabasta emit\s*·\s*digest\s+(sha256:[a-f0-9]{64})")
TARGET = os.environ.get("ALABASTA_RULES_TARGET", "agents_md")
SCOPE = os.environ.get("ALABASTA_RULES_SCOPE", "workspace")
FILENAMES = {
    "agents_md": "AGENTS.md",
    "claude_md": "CLAUDE.md",
    "cursor": ".cursor/rules/alabasta.mdc",
}


def quit_ok(message=None):
    if message:
        # SessionStart context is surfaced to the model; stdout is the channel.
        print(message)
    sys.exit(0)


def workspace_emit(site_url: str, api_key: str):
    request = urllib.request.Request(
        f"{site_url.rstrip('/')}/agent/v1/rules.emit",
        data=json.dumps({"target": TARGET, "scope": SCOPE}).encode(),
        headers={
            "content-type": "application/json",
            "authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=8) as response:
        return json.loads(response.read().decode())


def main():
    # Payload is read and discarded: this hook needs only cwd and the env.
    try:
        payload = json.load(sys.stdin)
    except Exception:
        payload = {}
    cwd = payload.get("cwd") or os.getcwd()

    site_url = os.environ.get("ALABASTA_SITE_URL")
    api_key = os.environ.get("ALABASTA_API_KEY")
    filename = FILENAMES.get(TARGET)
    if not site_url or not api_key or not filename:
        quit_ok()

    try:
        emit = workspace_emit(site_url, api_key)
    except (urllib.error.URLError, urllib.error.HTTPError, OSError, ValueError):
        quit_ok()

    remote = emit.get("digest")
    if not remote:
        quit_ok()

    path = os.path.join(cwd, filename)
    try:
        with open(path, "r", encoding="utf-8") as fh:
            local = DIGEST_RE.search(fh.read())
    except OSError:
        local = None

    if local and local.group(1) == remote:
        quit_ok()

    if local is None:
        quit_ok(
            f"Alabasta: {filename} carries no Alabasta emit header, but this workspace has "
            f"{emit.get('ruleCount', 0)} signed standing rule(s). Run `alabasta rules sync` to "
            "generate it, or read the rules with alabasta_get_standing_context."
        )
    quit_ok(
        f"Alabasta: {filename} has drifted from the workspace rules "
        f"(on disk {local.group(1)[:19]}…, workspace {remote[:19]}…). It is a generated artifact — "
        "run `alabasta rules sync` to regenerate it rather than editing it by hand."
    )


if __name__ == "__main__":
    main()
