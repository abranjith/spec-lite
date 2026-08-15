# Codebase Discovery and Update Rules

## Exploration Depth

| Level | Apply to | Work |
|---|---|---|
| **Deep** | Entry points, domain/business logic, orchestration, complex algorithms | Trace bodies and data flow; document rules and state transitions |
| **Standard** | Routes/controllers, middleware, data access, configuration, dependency wiring | Read signatures and key logic; document behavior and boundaries |
| **Skim** | Utilities, types, constants, repetitive CRUD, generated code | Read exports/signatures and representative examples only |
| **Catalog** | Tests, migrations, build/CI, static assets | Record tools and categories; inspect only representative examples |

Invest in business logic, integration boundaries, complex control flow, entry points, and routing. Avoid exhaustive boilerplate, generated output, repetitive tests, and every configuration key.

## Topology and Dependency Order

Detect `package.json` workspaces, solution/project files, Maven/Gradle builds, Python project files, Cargo workspaces, Go modules, compose services, and monorepo configuration. Classify the repository as single project, multi-project solution, workspace monorepo, polyglot/multi-service, or modular single package.

Map sibling dependencies, deployed entry points, and integration contracts. Explore top-down from user/deployed entry points through presentation/API, domain/services, persistence/integrations, and shared libraries. Use deployment configuration, dependency direction, entry points, root scripts, and conventional names as evidence; ask when more than one main application is plausible.

For independent subtrees, writers may be delegated separately only when their output files do not overlap. Preserve a concise dependency map and build/deploy order for architecture documentation.

## Diff and Merge

1. Read existing target documents before scanning source.
2. Preserve content clearly authored by the user. Generated sections may be replaced from verified evidence.
3. Update renamed/moved components and add implemented components.
4. Remove generated entries for deleted code; documentation reflects current state, not history.
5. Re-detect projects so added/removed packages update architecture and navigation.
6. If authorship is uncertain, preserve the section and surface the conflict instead of overwriting it.
7. Call out a fundamental architecture change in the affected current-state section, without changelog prose.
