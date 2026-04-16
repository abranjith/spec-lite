## Feature Summary Maintenance

After completing implementation (Feature Mode, Plan Mode, or Review Mode — if behavior changed), you MUST update `.spec-lite/feature-summary.md`. This document is the **current-state reference** for all implemented features — not a changelog, not a log. It reflects what each feature does *right now*.

### Rules

1. **Create if missing**: If `.spec-lite/feature-summary.md` does not exist, create it with the template below.
2. **Category assignment**: Place each feature under a meaningful domain category (e.g., `Order Management`, `Payment Processing`, `User Management`, `Notifications`). Use `General` for features that don't fit a specific category. **Do NOT nest categories** — keep the structure flat.
3. **Multi-category features**: If a feature touches multiple categories, add an entry under **each** relevant category. Keep entries consistent across categories but emphasize the category-relevant behavior in each.
4. **Latest first**: Within each category, the most recently updated feature goes at the **top**.
5. **Replace, don't append**: When updating an existing feature entry, **replace** the entire entry with the current state. Do not append — the old description is gone. The document reflects only what is true *now*.
6. **Concise & behavioral**: Describe *what the feature does* (observable behavior, key endpoints/commands, business rules), not *how it's implemented* (internal architecture, class names, design patterns). Keep each entry to 2–5 sentences.
7. **Fix-driven updates**: When the Fix skill changes a feature's observable behavior (e.g., a bug fix that alters validation rules, changes an API response format, or modifies a business rule), the corresponding entry in `feature-summary.md` must be updated to reflect the new behavior.
8. **No feature IDs in entries**: Do **not** include `FEAT-...` identifiers in `feature-summary.md` entries. Use only human-readable feature names so the summary stays stable and understandable over time.
9. **Link to source spec when available**: Add a `Source spec:` line under each entry with a relative markdown link to the originating feature spec file (for example, `[feature_user_management.md](.spec-lite/features/feature_user_management.md)`). This helps agents and humans quickly drill into implementation details.

### Template

```markdown
<!-- Maintained by spec-lite v0.0.8 | updated by: implement, fix skills -->

# Feature Summary

> **Current state only.** This document reflects what each feature does *right now* — not what it used to do.
> Maintained by the Implement and Fix skills after every code change that affects feature behavior.
> For change history, use source control (e.g., git).

---

## {{Category Name}}

**{{Feature Name}}** *(updated: {{date}} by {{agent}})*
Source spec: [feature_{{name}}.md](.spec-lite/features/feature_{{name}}.md)
{{Concise description of current feature behavior — what it does, key rules, important constraints. 2–5 sentences.}}

**{{Feature Name}}** *(updated: {{date}} by {{agent}})*
Source spec: [feature_{{name}}.md](.spec-lite/features/feature_{{name}}.md)
{{Concise description of current feature behavior.}}

---

## General

{{Catch-all for features that don't fit a specific domain category.}}
```

### Example

```markdown
## Order Management

**Order History** *(updated: 2026-03-20 by implement)*
Source spec: [feature_order_history.md](.spec-lite/features/feature_order_history.md)
Users can view paginated order history via `GET /orders?page=1&limit=20`. Supports filtering by status and date range. Returns order summary with line items. Empty orders return an empty array, not 404.

**Order Processing** *(updated: 2026-03-18 by fix)*
Source spec: [feature_order_processing.md](.spec-lite/features/feature_order_processing.md)
Users create orders from their cart via `POST /orders`. Orders follow a `pending → confirmed → shipped → delivered` state machine — `PATCH /orders/:id/status` enforces valid transitions. Inventory is validated and decremented on confirmation. Orders with zero items are now rejected with 400 (previously allowed).

---

## Payment Processing

**Checkout & Payment** *(updated: 2026-03-19 by implement)*
Source spec: [feature_checkout_payment.md](.spec-lite/features/feature_checkout_payment.md)
Checkout accepts credit card and PayPal via `POST /checkout`. Payment is processed asynchronously — order status moves to `confirmed` only after payment webhook confirms success. Failed payments leave the order in `pending` for retry.
```
