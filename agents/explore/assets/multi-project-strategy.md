## Multi-Project & Monorepo Exploration Strategy

Large repositories often contain multiple projects, packages, or services. The explorer MUST handle these strategically — not by trying to understand everything at once, but by treating each project as a discrete exploration unit and building understanding from the most important code outward.

### Step 1: Detect Repository Topology

During Phase 0 (Reconnaissance), classify the repository into one of these topologies:

| Topology | Signals | Example |
|----------|---------|---------|
| **Single project** | One `package.json` / `*.csproj` / `pom.xml` at root, one `src/` directory | A simple Express API |
| **Multi-project solution** | Multiple `*.csproj` / `*.sln` / subproject directories with their own build configs | .NET solution with Web, Core, Data projects |
| **Monorepo with workspaces** | Root `package.json` with `workspaces`, `pnpm-workspace.yaml`, `lerna.json`, Nx/Turborepo config | React app + API + shared libs in one repo |
| **Polyglot / multi-service** | Multiple language-specific config files, docker-compose with multiple services | Python API + React frontend + Go worker |
| **Mono-package with modules** | Single package config but multiple distinct modules/domains within `src/` | Large Express app with `src/users/`, `src/orders/`, `src/payments/` |

### Step 2: Build the Exploration Plan (Dependency-Aware Order)

**The cardinal rule: explore from the top of the dependency graph downward.** Start with what the end-user or external system touches first, then follow the dependency chain inward.

#### Ordering Heuristic

```
1. Main application / entry point project (what gets deployed, what users interact with)
   ├── 2. API / presentation layer projects
   │     ├── 3. Domain / business logic / service layer projects
   │     │     ├── 4. Data access / repository / persistence layer projects
   │     │     └── 4b. External integration projects (API clients, message producers)
   │     └── 3b. Shared DTOs / contracts / API models
   ├── 2b. Background workers / scheduled jobs
   └── 2c. Shared libraries / common utilities / cross-cutting concerns
```

#### Concrete Examples

**ASP.NET Solution** (`MyApp.sln`):
```
1. MyApp.Web          (ASP.NET MVC — the deployed app, references everything)
2. MyApp.Application  (use cases, CQRS handlers — orchestrates domain)
3. MyApp.Domain       (entities, value objects, domain services — pure business logic)
4. MyApp.Infrastructure (EF Core, email service, file storage — I/O implementations)
5. MyApp.Shared       (cross-cutting: exceptions, constants, extensions)
```

**Node.js Monorepo** (`packages/`):
```
1. packages/web        (Next.js frontend — what users see)
2. packages/api        (Express API — what the frontend calls)
3. packages/core       (business logic, domain services)
4. packages/database   (Prisma, migrations, repositories)
5. packages/shared     (types, utils, constants used everywhere)
```

**Microservices Repo**:
```
1. services/api-gateway    (entry point for all external traffic)
2. services/user-service   (core domain service)
3. services/order-service  (core domain service)
4. services/notification   (supporting service)
5. libs/common             (shared utilities, event schemas)
```

#### How to Determine the Main App

Use these signals (in priority order):
1. **Deployment config**: Dockerfile, `docker-compose.yml` services, Kubernetes manifests, CI/CD deploy steps — whatever gets deployed first or is the primary service.
2. **Dependency direction**: The project that imports/references the most other projects (and is not imported by any) is usually the main app.
3. **Entry points**: The project containing `main()`, `Program.cs`, `index.ts` with server startup, `manage.py`, etc.
4. **Root package scripts**: `start`, `dev`, `serve` scripts in the root `package.json` often point to the main app.
5. **Naming conventions**: Projects named `web`, `api`, `app`, `server`, `host`, `gateway` are typically the main entry.
6. **If ambiguous**: Ask the user. Don't guess when there are multiple plausible candidates.

### Step 3: Explore One Project at a Time

For each project in the planned order:

1. **Announce**: "Exploring project N of M: `<project-name>` (`<path>`)."
2. **Run Phases 1–6** scoped to that project's directory and its direct dependencies (imports from sibling projects count as "boundary" — note what it depends on, but explore the dependency in its own turn).
3. **Produce per-project documentation**: Write findings to `docs/explore/<project-name>.md`.
4. **Flush context**: Summarize cross-project insights (e.g., "this project depends on `core` for UserService") and discard raw file content before moving to the next project.
5. **Build the cross-reference map**: As you explore each project, maintain a running list of inter-project dependencies, shared types/interfaces, and integration points.

### Step 4: Handle Cross-Project Concerns

After exploring all individual projects, document these cross-cutting observations:

- **Shared patterns**: Conventions that are consistent across all projects (naming, error handling, logging).
- **Inconsistencies**: Places where projects diverge in approach (one project uses Repository pattern, another uses raw queries).
- **Dependency hotspots**: Shared libraries or interfaces that many projects depend on — these are high-impact change points.
- **Integration contracts**: How projects communicate (REST APIs, message queues, shared databases, gRPC, direct imports).
- **Build & deployment order**: The correct build order based on the dependency graph.

### Step 5: Produce Per-Project Documentation

Each project/package gets its own documentation file: `docs/explore/<project-name>.md`. This contains the full Phase 1–6 findings scoped to that project. See the **Per-Project Document Template** in the Output section.

### Step 6: Generate the Index

After all projects are documented, produce `docs/explore/INDEX.md` — a master document that:
- Lists every project with a one-paragraph summary and link to its doc file
- Shows the inter-project dependency graph (Mermaid diagram)
- Summarizes cross-cutting patterns and inconsistencies
- Provides a navigational starting point for anyone trying to understand the codebase

> **For single-project repositories**: Skip Phase 0 (Reconnaissance) and Phase 7 (Synthesis). Produce a single `docs/explore/<project-name>.md` and a simplified `docs/explore/INDEX.md` that just references it. The process is the same as before but scoped to the `docs/explore/` output directory.
