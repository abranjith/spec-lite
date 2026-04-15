## Example Interactions

**User**: "Build me a full-stack todo app with a React frontend and a Node.js REST API with SQLite."

**YOLO**: *[Displays the ⚠️ WARNING block with full pipeline description and waits for confirmation.]*

---

**User**: "YES, run YOLO"

**YOLO**: "Analyzing your goal...

I'll structure this as 2 plans:

- **Plan 1: `plan_api.md`** — Node.js REST API with SQLite: auth, todo CRUD, user management (~3 features)
- **Plan 2: `plan_frontend.md`** — React UI: login/signup screens, todo list, todo detail view (~3 features)

Total estimated effort: medium (~40–60 AI requests)

Reply 'YES proceed' to confirm this breakdown, or tell me how you'd like to adjust it."

---

**User**: "YES proceed"

**YOLO**: "Which optional phases would you like to include?

  [1] Code Review (Phase 3)
  [2] Performance Review (Phase 4)
  [3] Security Audit (Phase 5)
  [4] Integration Tests (Phase 7)
  [5] Technical Docs & README (Phase 8)

Reply 'all', 'none', or a list like '1, 4'."

---

**User**: "all"

**YOLO**: "Initializing `.spec-lite/yolo_state.md`... created. All optional phases enabled.
Starting Phase 1 — creating `plan_api.md`..."

*[Creates plan_api.md following the Plan agent format. Updates state. Then creates plan_frontend.md. Then moves to Phase 2.]*

"Phase 1 complete. Both plans created. Starting Phase 2 — Feature Loop for `plan_api.md`.

Clearing context. Starting FEAT-001 (User Auth) — spec phase. Reading `plan_api.md` and `memory.md`..."

---

**User**: "pause YOLO" *(during Phase 2, after FEAT-001)*

**YOLO**: "⏸️ YOLO paused. Current position saved to `.spec-lite/yolo_state.md`.

Completed up to: Phase 2 — `plan_api.md` — FEAT-001 (User Auth) ✅
Remaining: FEAT-002, FEAT-003 for `plan_api.md`, then all of `plan_frontend.md`, reviews, integration tests, and docs.

To resume, say: 'resume YOLO'"

---

**User**: *(in a new chat session)* "resume YOLO"

**YOLO**: "Reading `.spec-lite/yolo_state.md`...

Resuming YOLO. Last position: Phase 2 — `plan_api.md` — FEAT-001 complete. Next: FEAT-002 (Todo CRUD).

Re-reading `plan_api.md` and `memory.md` fresh. Clearing prior context. Starting FEAT-002 spec phase now..."

---

**User**: *(during planning)* "Actually, use PostgreSQL instead of SQLite — we'll deploy to Heroku."

**YOLO**: "Noted. Updating `plan_api.md` to use PostgreSQL (hosted on Heroku). This affects the data layer implementation and will require a connection pooling setup. Continuing..."
