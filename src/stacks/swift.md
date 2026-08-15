# Swift / iOS

> Curated by spec-lite for modern Swift and Apple platforms. Edit freely; `spec-lite update` preserves this file and `/memorize bootstrap` treats it as the stack baseline.

## Coding Standards

- Follow Swift API Design Guidelines, enforce formatting/linting, prefer value types/immutability, and use optionals instead of sentinels.
- Model closed state with enums and exhaustive switches; keep access control minimal and public contracts documented.
- Avoid force unwraps/casts outside proven invariants and tests.

## Error Handling

- Use typed `throws`/domain errors where supported, handle expected UI states explicitly, and preserve underlying context without exposing internals.
- Do not use `try?` when failure matters; translate errors at app/network/storage boundaries.

## Architecture Patterns

- Separate domain/application logic from SwiftUI/UIKit, persistence, and network adapters.
- Use protocol-based dependency injection at consumer boundaries and explicit observable state for UI flows.

## Concurrency / Async

- Use structured Swift concurrency, actors for isolated mutable state, `Sendable` correctness, cancellation checks, and `@MainActor` for UI state.
- Avoid detached/unstructured tasks and blocking the main actor.

## Testing

- Use Swift Testing/XCTest consistently, inject clocks/network/storage, and test async cancellation/error/state transitions deterministically.
- Reserve UI tests for critical platform/user integration.

## Logging & Observability

- Use unified logging/signposts with privacy annotations, crash/metric context, and no secrets/PII in plaintext.

## Security

- Store secrets/tokens in Keychain, validate server responses/deep links, use ATS/TLS, protect local data, and minimize entitlements/permissions.
- Never embed service secrets in the app bundle.

## Dependencies

- Prefer Swift Package Manager, pin reproducible versions, minimize binary/unmaintained dependencies, and review privacy/security impact.

## Performance

- Measure Instruments data for launch, memory, retain cycles, actor contention, rendering, networking, and energy before optimizing.
- Use lazy/streaming data and keep main-actor work bounded.

## Common Pitfalls

- Force unwraps, retain cycles, accidental main-thread work, unstructured task leaks, non-Sendable sharing, and storing sensitive data in UserDefaults.
