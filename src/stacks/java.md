# Java / Spring

> Curated by spec-lite for Java 21 and current Spring Boot. Edit freely; `spec-lite update` preserves this file and `/memorize bootstrap` treats it as the stack baseline.

## Coding Standards

- Enforce one agreed formatter/style in CI; use conventional package/type/member naming.
- Use records for immutable carriers, sealed types/pattern matching where they clarify closed domains, and `Optional` only for return absence.
- Prefer explicit immutable state and constructor injection; avoid field injection and inappropriate Lombok-generated equality on entities.
- Document public contracts, invariants, and checked/unchecked failure behavior without narrating obvious code.

## Error Handling

- Model expected domain failures explicitly and catch specific exceptions; never catch `Throwable` or swallow errors.
- Centralize API error translation with RFC 9457 Problem Details and prevent internal stack leakage.
- Keep transaction failure semantics explicit and preserve causes when wrapping.

## Architecture Patterns

- Organize cohesive domain features with clear controller/application/domain/infrastructure boundaries.
- Keep domain logic independent of Spring/JPA when complexity warrants hexagonal boundaries.
- Use DTOs at external contracts, short service-layer transactions, and events for genuinely decoupled side effects.

## Concurrency / Async

- Use virtual threads for high-concurrency blocking I/O when the stack supports them; do not combine models without measurement.
- Prefer structured executors, propagate deadlines/cancellation/context, and bound queues/retries.
- Avoid shared mutable state and long-held locks/transactions.

## Testing

- Use JUnit 5, AssertJ, and Mockito at external seams; use focused Spring slices before full-context tests.
- Use Testcontainers for behavior that depends on real database/broker semantics.
- Test domain rules, validation, transactions, authorization, and concurrency/error boundaries deterministically.

## Logging & Observability

- Use SLF4J structured fields, correlation/trace IDs, Micrometer/OpenTelemetry, and narrowly exposed Actuator endpoints.
- Never log secrets, credentials, tokens, or sensitive personal data.

## Security

- Configure Spring Security through `SecurityFilterChain`, validate with Bean Validation, parameterize persistence access, and retain CSRF for cookie/browser flows.
- Externalize secrets, use adaptive password hashing, enforce authorization/tenant boundaries, and audit dependencies/plugins.

## Dependencies

- Use Maven or Gradle consistently, align versions through BOM/platform support, commit wrappers/locks where applicable, and avoid dynamic versions.
- Keep the dependency graph lean and inspect conflicts/transitive vulnerabilities.

## Performance

- Measure JVM/GC, query counts, thread/connection pools, and latency before tuning.
- Prevent N+1 queries, eager over-fetching, unbounded result sets, and accidental long transactions.

## Common Pitfalls

- Blocking common pools, leaking JPA entities as APIs, lazy-loading surprises, broad catches, unbounded executors, and `Optional` fields/parameters.
