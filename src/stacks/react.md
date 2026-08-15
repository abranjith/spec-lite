# React / Next.js

> Curated by spec-lite for React 19 and modern Next.js. Edit freely; `spec-lite update` preserves this file and `/memorize bootstrap` treats it as the stack baseline.

## Coding Standards

- Use strict TypeScript, accessible semantic markup, focused components, named exports where framework rules permit, and consistent component/file naming.
- Keep rendering pure; derive state during render rather than synchronizing it through effects.
- Treat refs, memoization, and escape hatches as measured tools rather than defaults.
- Keep server/client boundaries explicit; add `"use client"` only where interactivity requires it.

## Error Handling

- Use route/component error boundaries and framework error/not-found/loading conventions.
- Translate API/action failures into typed user-safe states; log diagnostic detail on trusted server boundaries.
- Handle optimistic mutation rollback and abort stale requests.

## Architecture Patterns

- Prefer Server Components for data access/rendering and Client Components for interaction in App Router projects.
- Separate feature/domain logic from presentation; use custom hooks for reusable client behavior and server actions/API routes for trusted mutations.
- Use local state first, context for low-frequency shared state, and dedicated server-state tools only where needed.

## Concurrency / Async

- Use Suspense/transitions/streaming according to UX needs and keep async work cancellable or stale-result-safe.
- Avoid effect-driven fetch waterfalls and unbounded parallel requests; co-locate server fetching and batch independent work.
- Do not assume render occurs once; effects and subscriptions must be idempotent with cleanup.

## Testing

- Use Testing Library with Vitest/Jest and `userEvent`; assert accessible user behavior rather than component internals.
- Use MSW or boundary fakes for network behavior and a real browser for critical end-to-end flows.
- Keep snapshots small/stable and test server/client/error/loading boundaries.

## Logging & Observability

- Capture server and client errors with correlation/trace context, web-vital metrics, and source maps protected appropriately.
- Never expose/log tokens, secrets, or sensitive personal data in client bundles or telemetry.

## Security

- Validate again on the server, authorize every mutation/resource, sanitize untrusted HTML, use CSP, and keep sensitive tokens in secure httpOnly cookies.
- Avoid leaking server-only modules/environment variables into client bundles; protect cookie flows from CSRF.

## Dependencies

- Align React/framework/compiler versions, commit the lockfile, and avoid overlapping state/form/UI libraries without clear need.

## Performance

- Measure Web Vitals, bundle/chunk size, server latency, hydration, and rerenders before optimizing.
- Stream/code-split/virtualize where measured; optimize images/fonts and prevent client waterfalls/over-fetching.

## Common Pitfalls

- Hydration mismatch, stale closures, missing effect cleanup, derived state in effects, broad client boundaries, insecure server actions, and gratuitous memoization.
