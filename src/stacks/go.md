# Go

> Curated by spec-lite for Go 1.22+. Edit freely; `spec-lite update` preserves this file and `/memorize bootstrap` treats it as the stack baseline.

## Coding Standards

- Enforce `gofmt`/`goimports`, standard naming, small packages, and minimal exported API.
- Accept interfaces at consumer boundaries, return concrete types, and define interfaces only where behavior varies.
- Prefer zero-value-useful types, explicit constructors for invariants, and errors over boolean ambiguity.
- Document exported identifiers and keep dependencies/import direction simple.

## Error Handling

- Check every error, wrap with `%w` and context, and use `errors.Is/As`; never compare error strings.
- Reserve panic for unrecoverable programmer invariants; recover only at process/request boundaries with logging.
- Keep sentinel/typed errors stable only when callers need programmatic branching.

## Architecture Patterns

- Organize around cohesive domain/application packages with adapters for HTTP, persistence, messaging, and external APIs.
- Inject dependencies through constructors; avoid package globals and speculative abstraction layers.
- Keep handlers thin and transactions/retries owned by application operations.

## Concurrency / Async

- Pass `context.Context` first across I/O boundaries and honor cancellation/deadlines.
- Bound goroutines, worker pools, channels, retries, and queues; make ownership/closure of channels explicit.
- Protect shared state deliberately and run the race detector for concurrent code.

## Testing

- Use table-driven tests and subtests where they improve coverage/readability; test behavior with standard `testing` first.
- Use small fakes at interfaces and real services for protocol/database integration tests.
- Run `go test -race ./...` for concurrency-sensitive changes and fuzz parsers/boundaries where useful.

## Logging & Observability

- Use structured `log/slog` (or established equivalent), context fields, metrics/traces, and no secret/PII logging.

## Security

- Validate input, parameterize SQL, constrain paths/uploads, externalize secrets, use `crypto/*` primitives correctly, and audit modules.
- Apply timeouts/body limits and explicit auth/authorization on network handlers.

## Dependencies

- Keep `go.mod`/`go.sum` committed, prefer the standard library, pin tool versions, and review module provenance/advisories.

## Performance

- Benchmark/profile before optimizing; watch allocations, interface conversions, reflection, excessive goroutines, and unbounded reads.
- Stream large payloads and reuse buffers only when measurements justify complexity.

## Common Pitfalls

- Goroutine leaks, lost cancellation, typed-nil interfaces, deferred cleanup in long loops, variable shadowing, copied mutexes, and premature interfaces.
