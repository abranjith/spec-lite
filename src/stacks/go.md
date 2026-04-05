# Go — Best Practices & Conventions

> Curated by spec-lite. **Edit this file freely** to match your project — your changes are preserved across `spec-lite update`. The `/memorize bootstrap` agent reads this file as its starting baseline.

## Coding Standards

- Run **`gofmt`** (or `go fmt`) on all code — never argue about formatting, let the tool handle it. Use tabs for indentation.
- **Naming**: `MixedCaps` or `mixedCaps` — never underscores. Exported names start with an uppercase letter; unexported names start with lowercase.
- **Package names**: short, concise, lowercase, single-word. No underscores or mixedCaps. Avoid stuttering — a type in package `http` should be `Server`, not `HttpServer`.
- **Getters/Setters**: getter for field `owner` is `Owner()`, not `GetOwner()`. Setter is `SetOwner()`.
- **Interface names**: single-method interfaces use the method name plus `-er` suffix — `Reader`, `Writer`, `Formatter`, `Stringer`.
- **Acronyms**: keep consistent casing — `URL`, `HTTP`, `ID`, not `Url`, `Http`, `Id`. In mixed caps: `ServeHTTP`, `xmlHTTPRequest`.
- **File naming**: lowercase with underscores if multi-word — `my_handler.go`, `my_handler_test.go`.
- Use `const` and `iota` for enumerated constants. Design data structures so their zero values are immediately useful without initialization.
- Prefer composite literals with named fields — `&File{fd: fd, name: name}` — over positional arguments.
- Avoid `init()` functions unless truly needed for package-level setup. Keep them simple and predictable.

## Error Handling

- **Always check errors** — never discard an error return with `_`. If you must ignore it, document why.
- Return errors as the last return value: `func DoSomething() (Result, error)`.
- Use `fmt.Errorf` with `%w` to wrap errors and preserve the chain for `errors.Is` / `errors.As`.
- Define sentinel errors (`var ErrNotFound = errors.New("not found")`) or custom error types for domain-specific failures.
- Error strings should not be capitalized or end with punctuation — they are often composed with other messages.
- Prefer early returns to guard against errors — keep the happy path unindented and flowing down the page. Omit `else` when the `if` body ends in `break`, `continue`, `goto`, or `return`.
- Use `panic` only for truly unrecoverable programming errors (e.g., impossible states). Never use `panic` for normal error handling.
- Use `defer` + `recover` to catch panics at package boundaries — never let panics leak across API surface.

## Concurrency

- **"Do not communicate by sharing memory; share memory by communicating."** — prefer channels over mutexes when possible.
- Launch goroutines with `go` but always ensure they can terminate — avoid goroutine leaks. Use `context.Context` for cancellation and timeouts.
- Use **buffered channels** as semaphores to limit concurrency. Use unbuffered channels for synchronization.
- Protect shared mutable state with `sync.Mutex` or `sync.RWMutex` when channels are overkill (e.g., simple counters, caches).
- Use `sync.WaitGroup` to wait for a collection of goroutines to finish.
- Use `sync.Once` for lazy one-time initialization.
- Be careful with closures in goroutines — capture loop variables explicitly if needed (Go 1.22+ fixes `for` loop variable semantics).
- Use `select` with a `default` case for non-blocking channel operations. Use `select` with `context.Done()` for cancellation-aware work.
- **Concurrency is not parallelism** — structure programs as independently executing components that communicate, not as threads racing on shared data.

## Architecture Patterns

- **Small interfaces**: define interfaces where they are consumed, not where they are implemented. Accept interfaces, return concrete types.
- **Composition over inheritance**: use struct embedding to reuse behavior. Embedded types' methods are promoted but the receiver is the inner type, not the outer.
- **Dependency Injection**: pass dependencies via function parameters or struct fields. Avoid package-level globals for services.
- **Constructor pattern**: use `NewXxx()` functions to create and initialize types. Return the interface type when the concrete type is unexported.
- **Package design**: packages should be cohesive and focused. Avoid overly large packages; avoid overly fine-grained packages. Import cycles are compile errors — design your dependency graph carefully.
- Favor the standard library — `net/http`, `encoding/json`, `database/sql`, `context`, `io`, `os` cover most needs without external deps.
- Use `internal/` packages to restrict visibility of implementation details.

## Testing Conventions

- **Framework**: use the standard `testing` package. Prefer `go test ./...` to run all tests.
- **File naming**: test files sit alongside source files — `handler.go` → `handler_test.go`.
- **Test function names**: `TestXxx(t *testing.T)`. Use subtests with `t.Run("description", func(t *testing.T) { ... })` for table-driven tests.
- **Table-driven tests**: the idiomatic pattern for testing multiple cases — define a slice of test structs, loop with `t.Run`.
- Use `t.Helper()` in test helper functions so failure output references the caller, not the helper.
- Use `t.Parallel()` for tests that can safely run concurrently.
- Use `testdata/` directories for golden files and fixtures.
- For benchmarks: `BenchmarkXxx(b *testing.B)` with `b.N` loop iterations.
- Prefer real implementations over mocks when feasible. Use interfaces at boundaries to enable test doubles when needed.

## Logging

- Use the standard `log` or `log/slog` (Go 1.21+) packages. Prefer `slog` for structured, leveled logging in new projects.
- Never use `fmt.Println` for operational logging in production code.
- Log levels: `Error` (failures), `Warn` (recoverable issues), `Info` (key events), `Debug` (diagnostics).
- Include request IDs, trace context, or correlation identifiers in log entries for distributed tracing.
- Never log secrets, tokens, passwords, or PII.

## Security

- Validate and sanitize all external input at system boundaries. Use `strconv` for safe type conversions from strings.
- Use `html/template` (not `text/template`) for HTML output — it provides contextual auto-escaping against XSS.
- Use `crypto/rand` for cryptographic randomness — never `math/rand` for security-sensitive values.
- Store secrets in environment variables or a secrets manager — never commit to source control.
- Use `crypto/tls` with modern TLS configurations. Avoid disabling certificate verification.
- Keep dependencies updated — run `go mod tidy` and check for vulnerabilities with `govulncheck`.
- Be mindful of SQL injection — use parameterized queries with `database/sql`, never string concatenation.

## Common Pitfalls

- **Nil pointer dereference**: check interface values for `nil` — an interface holding a `nil` pointer is itself not `nil`.
- **Goroutine leaks**: always ensure goroutines can exit. Use `context` for cancellation, and drain channels properly.
- **Slice gotchas**: slices share underlying arrays — `append` may or may not allocate. Use `copy` or full slice expressions (`a[low:high:max]`) when you need independent slices.
- **Map concurrency**: maps are not safe for concurrent read/write — use `sync.Mutex` or `sync.Map`.
- **Deferred function arguments**: arguments to deferred functions are evaluated when `defer` executes, not when the deferred function runs. Use closures to capture changing values.
- **Shadowed variables**: `:=` in inner scopes creates new variables — watch out for accidentally shadowing `err` or other important variables.
- **Large struct copies**: pass large structs by pointer to avoid expensive copies. Methods that mutate state must use pointer receivers.
- **Ignoring `context`**: always propagate `context.Context` as the first parameter through call chains for cancellation and deadline support.
