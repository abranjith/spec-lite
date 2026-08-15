# TypeScript / Node.js

> Curated by spec-lite for TypeScript 5.x and ESM-first Node.js. Edit freely; `spec-lite update` preserves this file and `/memorize bootstrap` treats it as the stack baseline.

## Coding Standards

- Enable strict TypeScript and ESM; prefer `unknown` plus narrowing over `any`.
- Use `camelCase` values/functions, `PascalCase` types/classes, `UPPER_SNAKE_CASE` constants, and consistent kebab-case filenames.
- Prefer `const`, `readonly`, named exports, discriminated unions, `satisfies`, and type-only imports where appropriate.
- Validate external data at runtime; static types do not validate JSON, environment variables, or user input.

## Error Handling

- Model expected failures explicitly and use contextual custom errors for unexpected failures.
- Catch at boundaries, never swallow errors, and preserve `cause` when wrapping.
- Centralize HTTP/CLI error translation and avoid leaking stacks or internal details.

## Architecture Patterns

- Keep transport/UI, use-case/domain, and infrastructure concerns separated; dependencies point toward domain behavior.
- Inject I/O dependencies through constructors/functions and avoid mutable module singletons.
- Use repositories/adapters only where they protect a real boundary; keep controllers and command handlers thin.

## Concurrency / Async

- Prefer `async`/`await`, propagate cancellation with `AbortSignal`, and handle every promise.
- Use bounded concurrency for batch work; do not launch unbounded `Promise.all` operations.
- Avoid CPU-heavy synchronous work on the event loop; use workers or background processes when measured.

## Testing

- Prefer Vitest for ESM projects (Jest remains valid where established); test behavior and boundary contracts.
- Keep deterministic unit tests around domain logic and integration tests around I/O adapters.
- Mock external systems, not internal business logic; use builders/factories for readable fixtures.

## Logging & Observability

- Use structured logs (for example Pino), correlation IDs, metrics/traces at important boundaries, and no production `console.log`.
- Never log secrets, tokens, credentials, or sensitive personal data.

## Security

- Validate/normalize input, parameterize queries, allowlist dynamic identifiers, and use secure HTTP headers where applicable.
- Load secrets from environment/secrets managers; use Argon2id or bcrypt for passwords and secure cookies for browser tokens.
- Audit dependencies and minimize install scripts/unnecessary packages.

## Dependencies

- Commit the package-manager lockfile, pin the package manager, prefer stable/LTS runtime releases, and keep one module system.
- Add libraries only when they beat the maintenance cost of a small local abstraction.

## Performance

- Measure event-loop delay, latency, memory, and bundle/startup cost before optimizing.
- Prevent N+1 I/O, repeated serialization, unbounded collections/caches, and accidental large imports.

## Common Pitfalls

- Floating promises, missing `await`, circular barrel exports, unsafe type assertions, mixed CJS/ESM, and over-complex generics.
