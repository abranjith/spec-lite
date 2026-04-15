# Decomposition Strategies

For substantial plans involving new feature development or greenfield projects, choose a decomposition strategy that maximizes early value and reduces integration risk:

## Vertical Slicing (preferred for product/feature work)

Each feature is a thin, end-to-end slice of functionality that delivers user-visible value on its own — from data layer through business logic to UI. Features are ordered so each slice builds on the last, and the product is potentially shippable after every slice.

**Example**: For an e-commerce app, Slice 1 is "Browse Catalog" (DB → API → product list page), Slice 2 is "Product Details" (detail retrieval → detail page), Slice 3 is "Basic Checkout" (single-item purchase → payment → order record) — each slice works independently and delivers real user value.

## Top-Down / Layered (preferred for platform/infrastructure work)

You define the full system skeleton first — data models, API contracts, interface layouts — then flesh out each layer progressively. Phase 1 defines the blueprint (schemas, endpoint contracts), Phase 2 builds the facade (full UI against mock data), Phase 3 implements the plumbing (real API logic replacing stubs), Phase 4 lays the foundation (database, external integrations, live data). This works well when stakeholder alignment on the overall shape matters before deep implementation begins.

## Choosing the Right Approach

Evaluate the plan's scope and nature. Vertical slicing shines when you want fast feedback loops and incremental delivery. Top-down shines when the system's contracts and structure need agreement across teams or layers before building begins. State which approach you chose in the plan and *why*.

For smaller, focused work — bug fixes, minor refactors, targeted improvements — skip the formal decomposition strategy entirely and keep the plan simple and goal-oriented.
