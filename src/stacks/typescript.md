# TypeScript / Node.js — Best Practices & Conventions

> Curated by spec-lite. **Edit this file freely** to match your project — your changes are preserved across `spec-lite update`. The `/memorize bootstrap` agent reads this file as its starting baseline.

## Coding Standards

- Use **strict TypeScript** (`"strict": true` in `tsconfig.json`). Never use `any` unless explicitly justified and documented.
- **Naming**: `camelCase` for variables/functions, `PascalCase` for classes/interfaces/types/enums, `UPPER_SNAKE_CASE` for constants.
- **File naming**: `kebab-case.ts` for files, `PascalCase.ts` for files that export a single class.
- Prefer `interface` over `type` for object shapes that may be extended. Use `type` for unions, intersections, and mapped types.
- Use `readonly` and `const` by default. Mutate only when there's a clear reason.
- Prefer named exports over default exports for better refactoring support and tree-shaking.
- Use `enum` sparingly — prefer `const` objects with `as const` or union types for simple value sets.
- Avoid `null` where possible — prefer `undefined` for absence. Be consistent within the project.
- All public APIs must have JSDoc with `@param`, `@returns`, and `@example` where appropriate.

## Async & Error Handling

- Use `async/await` over raw Promises. Never mix callbacks with Promises.
- Always handle errors explicitly — no unhandled promise rejections. Use `try/catch` around `await` calls.
- Define custom error classes that extend `Error` for domain-specific failures. Include context (what failed, why, with what input).
- Never catch generic `Error` and silently swallow it. At minimum, log and re-throw.
- For Express/Fastify: use centralized error-handling middleware. Don't scatter `try/catch` in every route handler.

## Architecture Patterns

- **Layered architecture**: Separate routes/controllers → services/use-cases → repositories/data-access. Business logic must not depend on HTTP or database directly.
- **Dependency Injection**: Pass dependencies via constructor or function parameters. Avoid module-level singletons that are hard to test.
- **Repository Pattern** for data access — abstracts storage behind an interface, making it easy to swap implementations or mock in tests.
- **DTOs (Data Transfer Objects)**: Use Zod, class-validator, or io-ts to validate external input at the boundary. Never trust raw `req.body`.
- For NestJS: leverage modules, providers, and guards idiomatically. Keep controllers thin.
- For Express: use router-level middleware for cross-cutting concerns (auth, validation, logging).

## Testing Conventions

- **Framework**: Jest or Vitest (prefer Vitest for ESM-first projects).
- **File organization**: Mirror source structure — `src/services/user.ts` → `tests/services/user.test.ts` (or co-locate as `user.spec.ts`).
- **Naming**: Describe behavior, not methods — `it('returns 404 when user does not exist')` over `it('test getUser')`.
- **Arrange-Act-Assert (AAA)** pattern in every test.
- Mock external dependencies (DB, HTTP, file system) — never mock internal business logic.
- Use factories or builders for test data — avoid hardcoded fixtures that become brittle.
- Aim for high coverage on business logic and critical paths. Don't chase 100% on glue code.

## Logging

- Use **structured logging** (JSON format) with `pino` (preferred for performance) or `winston`.
- Never use `console.log` in production code. Use the configured logger.
- Log levels: `error` (failures), `warn` (recoverable issues), `info` (key business events), `debug` (diagnostics).
- Include correlation/request IDs in all log entries for traceability.
- Never log secrets, tokens, passwords, or PII.

## Security

- Validate and sanitize all external input at the boundary (Zod schemas, express-validator, etc.).
- Use `helmet` middleware for HTTP security headers.
- Store secrets in environment variables — never commit to source control.
- Use `bcrypt` or `argon2` for password hashing. Never store plaintext passwords.
- Keep dependencies updated — run `npm audit` regularly. Pin major versions.
- For JWTs: use short-lived access tokens + refresh tokens. Store refresh tokens securely (httpOnly cookies).

## Common Pitfalls

- **Circular dependencies**: Refactor shared types into a separate module. Use barrel files carefully.
- **Overusing `any`**: Defeats the purpose of TypeScript. Use `unknown` + type narrowing instead.
- **Missing `await`**: Always `await` async calls — floating promises are a common source of bugs.
- **Barrel file bloat**: Large `index.ts` re-exports can slow down build tools and create circular deps.
- **Overly complex generics**: If a generic type is hard to read, simplify or add a type alias with a clear name.
