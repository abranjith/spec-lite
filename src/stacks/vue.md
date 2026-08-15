# Vue / Nuxt

> Curated by spec-lite for Vue 3, Composition API, and modern Nuxt. Edit freely; `spec-lite update` preserves this file and `/memorize bootstrap` treats it as the stack baseline.

## Coding Standards

- Use strict TypeScript, `<script setup>`, accessible templates, consistent component/composable naming, and focused single-file components.
- Keep computed state derived and side effects in explicit watchers/hooks; avoid mutating props.
- Type emits, slots, route data, runtime config, and external payloads.

## Error Handling

- Use Vue/Nuxt error boundaries/hooks and typed user-safe async states; log trusted diagnostic context server-side.
- Abort/stale-guard async requests and handle optimistic rollback.

## Architecture Patterns

- Organize by feature with presentational components, composables for reusable behavior, stores for true shared client state, and server routes for trusted operations.
- In Nuxt, keep server-only code/config out of client bundles and use SSR-aware data APIs.

## Concurrency / Async

- Use Nuxt/Vue async data primitives to deduplicate/cancel work and avoid watcher/fetch waterfalls.
- Clean up watchers/subscriptions/timers and bound parallel requests.

## Testing

- Use Vitest + Vue Testing Library/Test Utils for accessible behavior and Playwright/Cypress for critical flows.
- Mock network boundaries with MSW and test SSR/hydration/loading/error/store behavior.

## Logging & Observability

- Capture client/server errors, Web Vitals, traces, and correlation without exposing secrets/PII or source maps publicly.

## Security

- Validate/authorize on the server, escape/sanitize untrusted HTML, use CSP/secure cookies/CSRF protections, and separate public/private runtime config.

## Dependencies

- Align Vue/Nuxt/Vite versions, commit the lockfile, and avoid overlapping stores/forms/UI libraries without clear need.

## Performance

- Measure hydration, rerenders, bundle/chunks, server latency, images, and data waterfalls.
- Lazy-load routes/components, virtualize measured large lists, and keep reactive graphs shallow when appropriate.

## Common Pitfalls

- Destructuring lost reactivity, broad watchers, hydration mismatch, prop mutation, client-exposed secrets, duplicated fetching, and oversized global stores.
