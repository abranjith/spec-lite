# .NET / C#

> Curated by spec-lite for .NET 8 and modern C#. Edit freely; `spec-lite update` preserves this file and `/memorize bootstrap` treats it as the stack baseline.

## Coding Standards

- Follow .NET naming/style analyzers, enable nullable reference types, and treat meaningful analyzer warnings as errors.
- Use records for immutable values/DTOs, classes for behavioral entities, file-scoped namespaces, and the established `I` interface convention.
- Prefer immutable/read-only state and clear public XML documentation; avoid interfaces with only one incidental implementation.
- Use pattern matching and modern language features when they simplify rather than obscure intent.

## Error Handling

- Use exceptions for unexpected failures and explicit result/validation types for expected outcomes.
- Catch specific exceptions at boundaries, preserve stack/cause, and centralize ASP.NET Core `IExceptionHandler`/Problem Details mapping.
- Never block on tasks or suppress cancellation/failure.

## Architecture Patterns

- Keep Domain/Application independent from Infrastructure/Presentation; inject ports/adapters through the built-in container.
- Keep controllers/endpoints thin, transactions inside application boundaries, and persistence behind purposeful abstractions.
- Use options validation for configuration and background services for durable asynchronous work.

## Concurrency / Async

- Use `async`/`await` end-to-end for I/O and pass `CancellationToken` through every cancellable boundary.
- Avoid `.Result`/`.Wait()`, unbounded `Task.WhenAll`, shared mutable state, and long-held locks.
- Use channels/queues and hosted services for bounded producer-consumer work.

## Testing

- Use xUnit/NUnit/MSTest consistently with fluent assertions where established; test behavior and contracts.
- Prefer fakes at infrastructure seams and `WebApplicationFactory`/Testcontainers for integration behavior.
- Cover cancellation, validation, authorization, error mapping, and concurrency-sensitive paths.

## Logging & Observability

- Use `ILogger` structured message templates, scopes/correlation, OpenTelemetry/Metrics, and health checks.
- Never log secrets, credentials, tokens, or sensitive personal data.

## Security

- Validate at boundaries, parameterize data access, enforce endpoint/resource authorization, protect cookie flows from CSRF, and use Data Protection/Key Vault equivalents.
- Store secrets outside source, use established password hashing/identity, and audit NuGet dependencies.

## Dependencies

- Use central package management where helpful, commit lockfiles for reproducible applications, pin SDKs with `global.json`, and prefer supported LTS releases.
- Minimize framework overlap and review transitive packages/licenses.

## Performance

- Benchmark/profile allocations, GC, thread/connection pools, EF query counts, and latency before optimizing.
- Use `IAsyncEnumerable`/streaming and pagination for large data; prevent N+1 and sync-over-async.

## Common Pitfalls

- Missing cancellation, `async void`, service-locator access, over-scoped DI services, tracked EF reads by default, and mutable shared singletons.
