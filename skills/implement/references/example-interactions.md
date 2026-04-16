## Example Interactions

**User**: "Implement `.spec-lite/features/feature_user_management.md`"

**Implement skill**: "I'll implement FEAT-001 (User Management). Reading the feature spec now... I see 5 tasks:

1. TASK-001: User model + migration
2. TASK-002: Sign-up endpoint
3. TASK-003: Sign-in with JWT
4. TASK-004: Profile retrieval
5. TASK-005: Profile update

Starting with TASK-001. I'll create the User model with the schema from the spec's Data Model section, write the migration, add unit tests, and update the docstrings. Working now..."

---

**User**: "Implement the order processing feature from the order-management plan"

**Implement skill**: "I see `.spec-lite/features/feature_order_processing.md` and I'll use `.spec-lite/plan_order_management.md` as the governing plan. Reading both now...

FEAT-003 has 4 tasks. Starting with TASK-001: Create Order model with status enum, cart reference, and payment fields. Working now..."

---

**User**: "Continue implementing — pick up where you left off on user management"

**Implement skill**: "Checking the State Tracking in `.spec-lite/features/feature_user_management.md`... TASK-001 and TASK-002 are marked `[x]`. TASK-003 (Sign-in with JWT) is next. Resuming from TASK-003..."

---

**User**: "Implement all features from the plan"

**Implement skill**: "Reading `.spec-lite/plan.md`... I see 3 features to implement:

- FEAT-001: User Management ([ ] Not started)
- FEAT-002: Order Processing ([ ] Not started)
- FEAT-003: Notifications ([ ] Not started)

Starting with FEAT-001. Reading `memory.md` and `.spec-lite/features/feature_user_management.md` fresh — clearing any prior context. Marking FEAT-001 as [/] In progress in the plan. Working on TASK-001 now..."

---

**User**: "Implement everything in plan_order_management.md — skip anything already done"

**Implement skill**: "Reading `.spec-lite/plan_order_management.md`... I see 2 incomplete features (FEAT-003 is already [x] Complete, skipping):

- FEAT-004: Shopping Cart ([ ] Not started)
- FEAT-005: Checkout Flow ([/] In progress — resuming)

Clearing prior context. Starting with FEAT-004. Reading plan, memory, and `.spec-lite/features/feature_shopping_cart.md` fresh. Working on TASK-001..."

---

**User**: "Implement the security fixes from the audit"

**Implement skill**: "Reading `.spec-lite/reviews/security_audit.md`... I see 4 findings to implement:

- SEC-001: Missing rate limiting on `/api/login` (Critical)
- SEC-002: Passwords stored with MD5 (Critical)
- SEC-003: Stack traces exposed in error responses (Medium)
- SEC-004: Missing `Strict-Transport-Security` header (Low)

Reading memory and plan for coding standards. Starting with SEC-001. Implementing rate limiting middleware per the Remediation field — writing the code, adding a test to confirm the endpoint rejects after 5 failed attempts, then annotating SEC-001 as resolved in the report. Working now..."

---

**User**: "Apply the High priority findings from the performance review"

**Implement skill**: "Reading `.spec-lite/reviews/performance_review.md`... Filtering to High priority:

- PERF-001: N+1 query in `OrderService.list_orders()` (High)
- PERF-002: Missing index on `orders.user_id` (High)

Reading memory and plan. Starting with PERF-001. Implementing eager loading per the Recommendation field, writing a query-count assertion test, then annotating as resolved. Working now..."
