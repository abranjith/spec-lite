# Ruby / Rails

> Curated by spec-lite for modern Ruby and Rails. Edit freely; `spec-lite update` preserves this file and `/memorize bootstrap` treats it as the stack baseline.

## Coding Standards

- Follow an enforced RuboCop style, conventional snake/Pascal naming, frozen/immutable values where useful, and small explicit methods.
- Use keyword arguments/value objects for complex contracts and type signatures (RBS/Sorbet) where the project benefits.
- Prefer clear objects/modules over metaprogramming that hides control flow.

## Error Handling

- Raise/rescue specific errors, preserve causes/context, and translate at controller/job/CLI boundaries.
- Do not rescue `Exception`, silently return `nil`, or use exceptions for routine branching.

## Architecture Patterns

- Keep controllers/jobs thin and domain/application behavior out of callbacks when it becomes nontrivial.
- Use service/value/form/query objects for cohesive responsibilities, repositories/adapters only at useful boundaries, and explicit transactions.

## Concurrency / Async

- Use jobs for durable asynchronous work with idempotency, bounded retry/backoff, and correlation.
- Understand runtime/process/thread/fiber safety; avoid mutable class/global state and non-thread-safe connection sharing.

## Testing

- Use RSpec or Minitest consistently, factories sparingly, deterministic DB isolation, and behavior-focused unit/request/job/system tests.
- Mock external boundaries, cover authorization/validation/transactions/retries, and avoid brittle implementation assertions.

## Logging & Observability

- Use structured logs with request/job IDs, ActiveSupport notifications/OpenTelemetry where useful, and no secrets/PII.

## Security

- Use strong parameters, authorization policies, CSRF/output escaping, parameterized Active Record, secure cookies/uploads, and Rails credentials/external secret stores.
- Run dependency/brakeman-style security audits.

## Dependencies

- Commit `Gemfile.lock` for applications, pin Ruby/Bundler, minimize unmaintained gems/native extensions, and review advisories/licenses.

## Performance

- Measure SQL/query counts, allocations/GC, rendering, boot time, job throughput, and cache behavior.
- Prevent N+1, unbounded scopes/enumeration, callback cascades, and per-row network work.

## Common Pitfalls

- Callback-heavy models, hidden N+1, symbol/string key drift, swallowed `nil`, shared mutable class state, non-idempotent jobs, and excessive metaprogramming.
