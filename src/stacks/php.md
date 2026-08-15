# PHP / Laravel

> Curated by spec-lite for modern PHP and Laravel. Edit freely; `spec-lite update` preserves this file and `/memorize bootstrap` treats it as the stack baseline.

## Coding Standards

- Use strict types, PSR-12 formatting, static analysis (PHPStan/Psalm), explicit parameter/return/property types, and immutable value objects where practical.
- Follow `camelCase` members, `PascalCase` types, PSR-4 namespaces, and small intention-revealing methods.
- Prefer constructor promotion/read-only state and enums over stringly typed flags.

## Error Handling

- Use domain exceptions/results consistently, catch narrowly at HTTP/queue/CLI boundaries, and centralize safe error responses.
- Never suppress errors or leak traces/configuration to users; preserve causes/context in trusted logs.

## Architecture Patterns

- Keep controllers/commands/jobs thin; place business rules in application/domain services and persistence/external calls behind adapters.
- Use container injection rather than facades/globals in core logic; keep Eloquent models from becoming external API contracts.

## Concurrency / Async

- Use queues/workers for long-running work, make jobs idempotent, bound retries/backoff, and carry correlation context.
- Treat worker processes as long-lived: reset request state/resources and avoid mutable static leakage.

## Testing

- Use PHPUnit/Pest consistently with factories, deterministic database isolation, and focused unit/integration/HTTP/queue tests.
- Mock external services, not business logic; cover validation, authorization, transactions, retries, and error mapping.

## Logging & Observability

- Use structured PSR-3 logs, request/job correlation, metrics/traces, and no secrets/PII.

## Security

- Use framework validation/authorization/CSRF/session protections, parameterized ORM/query builder access, output escaping, secure uploads, and adaptive password hashing.
- Externalize secrets and audit Composer dependencies.

## Dependencies

- Commit `composer.lock` for applications, constrain compatible versions, prefer maintained packages, and minimize Laravel/framework overlap.

## Performance

- Measure queries, N+1 relations, serialization, cache behavior, worker memory, and opcache/runtime latency.
- Paginate/stream large results and eager-load only verified needs.

## Common Pitfalls

- Mass assignment, hidden N+1 queries, fat controllers/models, facade-coupled tests, state leaks in workers, unbounded jobs, and truthiness/type-coercion bugs.
