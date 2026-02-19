# React / Next.js — Best Practices & Conventions

> Curated by spec-lite. **Edit this file freely** to match your project — your changes are preserved across `spec-lite update`. The `/memorize bootstrap` agent reads this file as its starting baseline.

## Coding Standards

- Use **TypeScript** with strict mode for all React projects.
- **Naming**: `PascalCase` for components and component files, `camelCase` for hooks (`useAuth`, `useFetch`), `UPPER_SNAKE_CASE` for constants.
- One component per file. File name must match the exported component name.
- Prefer **function components** with hooks over class components.
- Prefer **named exports** for components — default exports only for page-level components in Next.js (required by the framework).
- Use absolute imports with path aliases (e.g., `@/components/Button`) over deep relative paths.
- Co-locate related files: `Button/Button.tsx`, `Button/Button.test.tsx`, `Button/Button.module.css`.

## Component Patterns

- Keep components **small and focused** — if a component exceeds ~150 lines, extract sub-components.
- Separate **presentational** (UI) from **container** (data-fetching/logic) concerns. Use custom hooks to extract logic.
- Use **composition** over prop-drilling. Prefer `children` and render props for flexible layouts.
- Avoid prop drilling deeper than 2 levels — use Context or state management for shared state.
- For forms: use a form library (React Hook Form, Formik) for anything beyond trivial forms. Validate with Zod or Yup.
- Prefer **controlled components** over uncontrolled unless performance requires otherwise.

## Hooks Rules

- Only call hooks at the top level — never inside conditions, loops, or nested functions.
- Custom hooks must start with `use` prefix.
- Use `useMemo` and `useCallback` only when there's a measurable performance benefit — don't prematurely optimize.
- Use `useRef` for values that don't trigger re-renders (timers, DOM refs, previous values).
- Avoid `useEffect` for derived state — compute it during render instead.
- Cleanup side effects in `useEffect` — return a cleanup function for subscriptions, timers, and event listeners.

## State Management

- Start with **local state** (`useState`). Lift state only when siblings need it.
- Use **React Context** for low-frequency global state (theme, auth, locale).
- For complex client-side state, use Zustand (lightweight) or Redux Toolkit (large apps).
- For server state, use **TanStack Query** (React Query) or SWR — never manage server cache manually with `useState` + `useEffect`.
- In Next.js App Router: prefer **Server Components** for data fetching. Use `"use client"` only when client interactivity is needed.

## Testing Conventions

- **Framework**: Vitest or Jest + React Testing Library.
- Test **behavior**, not implementation — query by role, label, and text, not by test IDs or CSS selectors.
- Never test internal component state directly. Test what the user sees and interacts with.
- Use `userEvent` over `fireEvent` for realistic user interaction simulation.
- Mock API calls with MSW (Mock Service Worker) for integration tests.
- Snapshot tests: use sparingly and only for stable UI — they become maintenance burdens quickly.

## Next.js Specific

- Use the **App Router** (default since Next.js 13+) unless maintaining a legacy Pages Router project.
- Prefer **Server Components** by default. Add `"use client"` only for interactive components.
- Use `loading.tsx`, `error.tsx`, and `not-found.tsx` for built-in loading/error states.
- Data fetching: use `fetch` in Server Components with built-in caching, or Server Actions for mutations.
- Image optimization: always use `next/image` over raw `<img>` tags.
- Use route groups `(group)` to organize routes without affecting the URL structure.

## Performance

- Use `React.lazy()` and `Suspense` for code-splitting large components/routes.
- Virtualize long lists with `react-window` or `@tanstack/react-virtual`.
- Avoid unnecessary re-renders: use `React.memo` for expensive pure components, but measure first.
- Keep bundle size in check — analyze with `@next/bundle-analyzer` or `source-map-explorer`.

## Security

- Sanitize any user-generated HTML before rendering — never use `dangerouslySetInnerHTML` with unsanitized content.
- Use CSP (Content Security Policy) headers — Next.js supports them via `next.config.js`.
- Store tokens in httpOnly cookies, not localStorage.
- Validate all form input client-side (UX) AND server-side (security).

## Common Pitfalls

- **Infinite re-render loops**: Caused by `useEffect` with missing or incorrect dependencies.
- **Stale closures**: Hooks capture values at render time — use `useRef` for mutable values that need to be current.
- **Over-fetching in `useEffect`**: Use TanStack Query or SWR instead of manual `useEffect` + `fetch` patterns.
- **Hydration mismatches** (Next.js): Ensure server-rendered HTML matches client-rendered output. Avoid `typeof window` checks in render.
- **Prop type drift**: Always type component props with TypeScript interfaces. Never use `any` for props.
