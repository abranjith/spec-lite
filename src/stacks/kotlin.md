# Kotlin / Android

> Curated by spec-lite for modern Kotlin, JVM services, and Android. Edit freely; `spec-lite update` preserves this file and `/memorize bootstrap` treats it as the stack baseline.

## Coding Standards

- Follow official Kotlin style, enforce formatting/static analysis, prefer immutable `val`, data/value classes, sealed hierarchies, and explicit public APIs.
- Use nullable types and exhaustive expressions instead of sentinel values/unchecked assertions.
- Prefer extension/top-level functions only when ownership remains clear; avoid Java-style boilerplate.

## Error Handling

- Use exceptions for unexpected failures and sealed result/domain types for expected outcomes.
- Catch narrowly at boundaries, preserve causes, and map service/UI errors to safe stable contracts.

## Architecture Patterns

- Keep domain/use cases independent from Android/Spring/Ktor adapters and persistence/network implementations.
- Inject dependencies, keep UI/controllers thin, and model state explicitly (for Android, unidirectional state flow).

## Concurrency / Async

- Use structured coroutines with owned scopes, cancellation, dispatchers, and bounded flow buffering.
- Never use `GlobalScope`; avoid blocking dispatchers and shared mutable state.

## Testing

- Use JUnit 5/Kotest as established, coroutine test dispatchers, deterministic Flow/state assertions, and fakes at boundaries.
- Add device/UI tests only for platform integration and critical user flows.

## Logging & Observability

- Use structured service logging or platform-safe logging with correlation/crash context; redact secrets and PII.

## Security

- Validate input, parameterize persistence, externalize service secrets, use platform keystores for device secrets, and minimize exported Android components/permissions.

## Dependencies

- Use Gradle Kotlin DSL/version catalogs where established, commit wrappers/locks, align Kotlin/plugin versions, and audit transitive libraries.

## Performance

- Measure coroutine contention, allocation, serialization, startup, UI recomposition, and database/network work.
- Bound flows/collections and move blocking/CPU work to appropriate dispatchers.

## Common Pitfalls

- `!!`, leaked coroutine scopes, swallowed cancellation, blocking `runBlocking` in production, mutable shared flows/state, and Android lifecycle leaks.
