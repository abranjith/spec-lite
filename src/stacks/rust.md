# Rust

> Curated by spec-lite for stable Rust. Edit freely; `spec-lite update` preserves this file and `/memorize bootstrap` treats it as the stack baseline.

## Coding Standards

- Enforce `cargo fmt --check` and Clippy across targets/features; use idiomatic snake/Pascal/SCREAMING naming.
- Accept borrowed forms (`&str`, `&[T]`) when ownership is unnecessary; minimize clones and public visibility.
- Use newtypes, enums, traits, and typestate where they encode invariants clearly; document public APIs and unsafe contracts.
- Keep unsafe code isolated behind a safe interface with explicit invariants.

## Error Handling

- Return `Result`; use typed `thiserror` errors for libraries and contextual `anyhow` errors for applications.
- Propagate with `?`, preserve sources/context, and reserve `unwrap`/panic for tests or documented impossible invariants.
- Return owned inputs on recoverable ownership-consuming failures when retry is useful.

## Architecture Patterns

- Use small traits at consumer boundaries, composition over inheritance-like `Deref`, and modules/crates aligned to cohesive responsibilities.
- Keep domain logic independent of I/O/framework adapters and treat public APIs as semver contracts.
- Prefer explicit builders/defaults for complex construction.

## Concurrency / Async

- Choose one async runtime; use structured joins/selects/channels and cooperative cancellation.
- Do not hold synchronous locks across `.await`; bound tasks/queues and keep lock guards short.
- Prefer message passing; use `Arc<Mutex/RwLock>` only with clear ownership/contention reasoning.

## Testing

- Use unit, integration, and doc tests; test all relevant feature combinations.
- Use property/fuzz testing for parsers/invariants and trait-based fakes at I/O seams.
- Keep tests deterministic and run Miri/sanitizers where unsafe code warrants them.

## Logging & Observability

- Use `tracing` spans/structured fields (or `log` facade for libraries), metrics/OpenTelemetry where useful, and redact sensitive values by type.

## Security

- Validate with strict Serde types, parameterize queries, use audited crypto/TLS crates, externalize secrets, and run `cargo audit`/`cargo deny`.
- Audit unsafe/FFI boundaries and convert raw inputs to safe types immediately.

## Dependencies

- Commit `Cargo.lock` for applications (follow ecosystem policy for libraries), minimize features/transitive crates, and review advisories/licenses.

## Performance

- Benchmark/profile allocations, cloning, locking, async scheduling, and serialization before optimizing.
- Prefer iterators/streaming and bounded collections; avoid premature unsafe or complex lifetime tricks.

## Common Pitfalls

- Cloning to appease borrows, long-held guards, blocking in async, accidental panics, `RefCell` borrow failures, feature-matrix gaps, and overbroad `pub`.
