## Example Interactions

**User**: `/memorize All public methods must have ENTRY/EXIT logging at DEBUG level. Never use console.log in production code.`

**Memorize skill**: "Got it. I've added two instructions to `.spec-lite/memory.md`:

- **Logging**: 'All public methods must have ENTRY/EXIT logging at DEBUG level.'
- **Logging**: 'Never use `console.log` in production code — use the structured logger.'

These will be enforced by all skills and agents going forward."

---

**User**: `/memorize Use Winston for logging.`

*(Existing memory has: "Use Pino for structured logging.")*

**Memorize skill**: "I found a conflict with an existing instruction:

- ⚠️ **Conflict in Logging**: Existing: 'Use Pino for structured logging.' vs. New: 'Use Winston for logging.'

Which should I keep — the existing rule (Pino), the new rule (Winston), or a merged version?"

**User**: "Keep Winston."

**Memorize skill**: "Done. Updated `.spec-lite/memory.md`:

- **Logging**: 'Use Pino for structured logging.' → 'Use Winston for logging.'

All skills and agents will now use Winston."

---

**User**: `/memorize All functions must be documented.`

*(Existing memory has: "Every function needs a docstring with @param and @returns.")*

**Memorize skill**: "This looks like a near-duplicate of an existing instruction:

- 🔄 **Near-duplicate in Documentation**: Existing: 'Every function needs a docstring with @param and @returns.' vs. New: 'All functions must be documented.'

The existing rule is more specific. Should I keep the existing wording, adopt the new (less specific) wording, or merge them?"

**User**: "Keep existing."

**Memorize skill**: "Got it — no changes made. The existing rule already covers this."

---

**User**: `/memorize override All list endpoints must return paginated results with a max page size of 50. Use cursor-based pagination, not offset.`

**Memorize skill**: "Added to `.spec-lite/memory.md`:

- **Performance**: 'All list endpoints must return paginated results with a max page size of 50. Use cursor-based pagination, not offset.'

This overrides any conflicting pagination rules."

---

**User**: `/memorize bootstrap`

**Memorize skill**: "Starting project bootstrap — let me analyze your project config.

**Reading profile**: Found `.spec-lite.json` — TypeScript, Express + React, Vitest, Monorepo.

**Reading manifest & config**:
- `package.json` → Node 20, Express 4.19, React 18.3, TypeScript 5.4
- `tsconfig.json` → strict mode enabled, paths configured
- `vitest.config.ts` → found, workspace mode
- `.eslintrc.js` → Airbnb base with custom overrides
- Top-level dirs: `packages/api/`, `packages/web/`, `packages/shared/`

**Reading stack snippet**: Found `.spec-lite/stacks/typescript.md` — adapting to your project config.

Here's the generated memory — 11 sections, 42 standing instructions:

*(shows full memory.md preview)*

Does this look right? I can adjust anything before writing to `.spec-lite/memory.md`.

> **Tip**: For conventions based on actual codebase patterns (naming conventions in use, architectural patterns discovered from code, etc.), run the Explore agent — it will analyze your source code and merge its findings into memory."
