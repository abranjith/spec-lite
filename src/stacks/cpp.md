# C / C++

> Curated by spec-lite for modern C++ (C++20/23 where supported) and safe C interoperability. Edit freely; `spec-lite update` preserves this file and `/memorize bootstrap` treats it as the stack baseline.

## Coding Standards

- Enforce one formatter/static-analysis profile; use RAII, value semantics, `const`, strong types, and the Core Guidelines.
- Prefer standard containers/views/algorithms, smart ownership types, spans/string views for non-owning ranges, and narrow interfaces.
- In C, make ownership/lifetime/error contracts explicit and centralize cleanup paths.
- Document public lifetime, threading, allocation, and exception/error guarantees.

## Error Handling

- Choose exceptions or explicit result/status types consistently at module boundaries; never ignore return codes.
- Preserve error context, maintain RAII cleanup, and translate exceptions across C/FFI/ABI boundaries.

## Architecture Patterns

- Separate domain logic from OS/framework/I/O adapters; inject interfaces only at real variability/testing seams.
- Use pImpl/module boundaries for ABI/compile isolation where justified; avoid global mutable state.

## Concurrency / Async

- Prefer structured task/executor abstractions and message passing; document thread safety and ownership.
- Use atomics/mutexes with explicit memory/contention reasoning, bounded queues, and race/deadlock tooling.

## Testing

- Use one established framework plus sanitizers, static analysis, fuzzing, and property tests for parsers/invariants.
- Test resource cleanup, error paths, concurrency, platform/ABI boundaries, and representative optimized builds.

## Logging & Observability

- Use structured/leveled logging and metrics/tracing at boundaries; never log secrets or sensitive personal data.

## Security

- Validate sizes/ranges, avoid unsafe C string/buffer APIs, use bounds-aware types, parameterize queries, and use audited crypto.
- Run ASan/UBSan/TSan/MSan where applicable and audit dependencies/toolchains.

## Dependencies

- Pin reproducible toolchains/packages, commit lock metadata, minimize transitive/native supply-chain risk, and document compiler/platform support.

## Performance

- Profile realistic optimized builds before changing ownership/layout/algorithms.
- Watch allocation, copies, cache locality, false sharing, lock contention, I/O batching, and unbounded containers.

## Common Pitfalls

- Raw owning pointers, dangling views, undefined behavior, integer overflow, exceptions across ABI, data races, macro overuse, and premature template complexity.
