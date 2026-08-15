# Angular

> Curated by spec-lite for modern standalone Angular and signals. Edit freely; `spec-lite update` preserves this file and `/memorize bootstrap` treats it as the stack baseline.

## Coding Standards

- Use strict TypeScript/templates, standalone components, consistent Angular naming, accessible templates, and focused components/services.
- Prefer signals/computed state for local synchronous state and RxJS for event/async streams; keep external payloads runtime-validated.
- Use immutable inputs/state and explicit typed public APIs.

## Error Handling

- Centralize HTTP/application error translation, expose typed user-safe states, and preserve diagnostic context in trusted reporting.
- Handle observable errors deliberately; never leave silent subscriptions or blanket fallbacks.

## Architecture Patterns

- Organize by lazy feature/domain boundaries, keep components presentational, move orchestration to facades/application services, and isolate HTTP/storage adapters.
- Use DI tokens at real boundaries and route guards/resolvers only for navigation concerns.

## Concurrency / Async

- Prefer async pipe/signals and cancellable RxJS composition (`switchMap`, teardown helpers) over manual nested subscriptions.
- Bound parallel requests, avoid duplicate subscriptions, and clean up effects/resources.

## Testing

- Use the Angular test environment with behavior-focused component/service tests and Playwright/Cypress for critical flows.
- Test signals/observables with deterministic schedulers where needed and mock HTTP/external boundaries.

## Logging & Observability

- Capture global errors, route/API tracing, Web Vitals, and correlation; keep secrets/PII and sensitive source maps out of client telemetry.

## Security

- Rely on template escaping, sanitize exceptional HTML carefully, validate/authorize server-side, use CSP/secure cookies/CSRF protections, and never put secrets in environment bundles.

## Dependencies

- Keep Angular/CLI/CDK versions aligned, commit the lockfile, use supported migrations, and minimize overlapping state/UI libraries.

## Performance

- Measure change detection, signal/observable fan-out, bundle size, lazy chunks, rendering, and network waterfalls.
- Use track expressions, lazy routes, deferrable views, and virtualization only where measured.

## Common Pitfalls

- Nested subscriptions, leaked effects, business logic in components, zone/change-detection churn, client-bundled secrets, giant shared modules/stores, and unsafe HTML bypasses.
