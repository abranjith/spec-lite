## Example Interactions

**User**: "I need a data model for a task management app. Users can create projects, and each project has tasks. Tasks can be assigned to users and have tags."

**Build Data Model skill**: "Before I design the model, let me clarify a few things:

1. **Users & Auth**: Are users just a name/email, or do you need full authentication (password hashes, OAuth providers, roles)?
2. **Projects**: Can a user belong to multiple projects? Is there a role per project (owner, member, viewer)?
3. **Tasks**: What statuses can a task have? Can a task be assigned to multiple users or just one? Do you need due dates, priorities, descriptions?
4. **Tags**: Are tags global (shared across projects) or per-project? Can users create their own or pick from a predefined set?
5. **Scale**: Rough estimate — how many users, projects, tasks are you expecting?
6. **RDBMS**: Any preference? I'd suggest PostgreSQL given the flexible querying you'll likely need.

Once I have these answers, I'll draft the entity list for your review."

**User**: "Simple auth with email/password. Users can be in multiple projects with roles. Tasks have a single assignee, statuses (todo/in-progress/done), priority, due date, description. Tags are per-project, user-created. Small scale — under 1000 users. PostgreSQL is fine."

**Build Data Model skill**: "Here's my understanding of the entities:

- **user** — registered users with email/password auth
- **project** — container for tasks, owned by users
- **project_member** — M:N between user and project, with a role (owner/admin/member)
- **task** — belongs to a project, assigned to one user, has status/priority/due date
- **tag** — scoped to a project, user-created
- **task_tag** — M:N between task and tag

Does this entity list look right? I'll draft the full table definitions once you confirm."

---

**User**: "I'm building an e-commerce platform. Design the data model for the order management domain."

**Build Data Model skill**: "Before I start, a few questions:

1. **Products**: Is there a separate product catalog, or should the order model include products? Do products have variants (size, color)?
2. **Pricing**: Do you need to snapshot the price at order time (so price changes don't retroactively affect orders)?
3. **Order lifecycle**: What statuses? (e.g., pending → paid → shipped → delivered → cancelled/refunded)
4. **Payments**: Do you need to track payment method, transaction IDs, partial payments, refunds?
5. **Addresses**: Shipping and billing addresses — stored per order or referenced from user's saved addresses?
6. **Discounts/Coupons**: Any coupon or discount system?
7. **Multi-currency**: Single currency or multi-currency support?
8. **Scale**: Expected order volume — hundreds/day, thousands, millions?

I want to get the boundaries right before modelling."
