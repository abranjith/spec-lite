# Python

> Curated by spec-lite for Python 3.12+. Edit freely; `spec-lite update` preserves this file and `/memorize bootstrap` treats it as the stack baseline.

## Coding Standards

- Use `pyproject.toml`, Ruff/Black-compatible formatting, and strict Pyright or mypy on maintained code.
- Type public functions with modern syntax (`list[str]`, `X | None`, protocols/generics where useful); avoid untyped dictionary contracts.
- Use `snake_case`, `PascalCase`, immutable/frozen dataclasses where appropriate, and concise docstrings for public behavior.
- Avoid mutable defaults and broad dynamic features when a clear typed construct exists.

## Error Handling

- Catch specific exceptions, add contextual domain exceptions, and never use bare `except` or silent handling.
- Use context managers for files, sessions, transactions, and locks; translate failures at API/CLI boundaries.
- Preserve exception chaining with `raise ... from ...` when wrapping.

## Architecture Patterns

- Separate framework adapters from application/domain logic and persistence/integration adapters.
- Use protocols or injected callables at boundaries instead of framework-coupled globals.
- Use Pydantic/dataclasses for structured input and output; keep web handlers/views thin.

## Concurrency / Async

- Use `asyncio`/structured task groups for I/O concurrency and processes/native code for CPU-bound work.
- Do not call blocking libraries inside the event loop; propagate cancellation and close async resources.
- Bound fan-out, queues, retries, and background tasks.

## Testing

- Use pytest with deterministic fixtures, behavior-focused names, and async plugins only when needed.
- Mock external I/O at clear seams; use factories over brittle global fixtures.
- Cover exception paths, validation boundaries, and representative integration behavior.

## Logging & Observability

- Configure standard logging or structlog centrally with structured fields, correlation context, metrics/traces where useful, and no `print` in production.
- Never log secrets, credentials, tokens, or sensitive personal data.

## Security

- Validate external input, parameterize queries, constrain file paths/uploads, and use framework CSRF/CORS/auth protections intentionally.
- Load secrets externally and use established password/cryptography libraries; never design custom crypto.
- Run `pip-audit` (or equivalent) and review transitive dependencies.

## Dependencies

- Declare metadata/dependencies in `pyproject.toml`, commit a reproducible lock/constraints file, and isolate environments.
- Prefer maintained packages with typed APIs and avoid duplicate libraries for the same role.

## Performance

- Profile before optimizing; watch N+1 queries, unnecessary object churn, repeated parsing, and unbounded materialization.
- Stream/chunk large inputs and choose threads/processes/async according to measured workload.

## Common Pitfalls

- Mutable defaults, blocking calls in async code, circular imports, forgotten awaits, overuse of `Any`/`**kwargs`, and leaked resources.
