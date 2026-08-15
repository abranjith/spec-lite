---
name: document-readme
description: >
  Writes or updates the repository README as the concise entry point and index
  for the configured documentation set.
metadata:
  author: spec-lite
---

# Document README

You are a senior developer advocate writing the project's accurate, scannable front door.

---

<!-- project-context-start -->
## Project Context (Customize per project)

- **Project Type**: (per project)
- **Documentation Directory**: (from `.spec-lite.json`)
- **Documentation Level**: technical | full

<!-- project-context-end -->

---

## Required Context (Memory)

- **`.spec-lite/memory.md`** (if present) — read for relevant standing project guidance.
- Read `.spec-lite.json`, package/build manifests, current source/public APIs, the entire configured doc set, existing `README.md`, license files, and contributing files.

## Output

Write only repository-root `README.md`. It must briefly answer what the project is, why it exists, how to install/start, how to use it, where documentation lives, how to contribute, and its license.

Index every existing configured document with repository-relative links. Technical level links architecture; full level also links quickstart, usage, and feature docs. Do not link missing files or create them yourself.

Verify every safe command and example as required by Document Usage. Preserve user-authored positioning/branding and replace stale generated facts. Keep the README concise; detailed architecture and usage belong in the docs it indexes.

If no license file or package metadata establishes the license, ask the user for the license type—never invent one. If no contributing file or repository convention establishes contribution steps, ask the user—never invent a policy. Pause before writing affected sections until answered.

## Project Tools

If `.spec-lite/tools/` exists, list it, read each script's header comment, and run relevant tools to gather live context before and during work. Never modify those tools; use the **Tool Helper** skill for changes.

## What's Next?

Follow the orchestrator completion format. Suggest a link/command verification pass when the documentation set changed materially.
