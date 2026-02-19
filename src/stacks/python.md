# Python — Best Practices & Conventions

> Curated by spec-lite. **Edit this file freely** to match your project — your changes are preserved across `spec-lite update`. The `/memorize bootstrap` agent reads this file as its starting baseline.

## Coding Standards

- Follow **PEP 8** for style. Use a formatter (Black or Ruff) and linter (Ruff, flake8, or pylint) enforced in CI.
- **Type hints** (PEP 484) on all function signatures and return types. Use `mypy` or `pyright` in strict mode.
- **Naming**: `snake_case` for functions/variables/modules, `PascalCase` for classes, `UPPER_SNAKE_CASE` for constants.
- **File naming**: `snake_case.py` for all modules.
- Keep functions short and focused — one purpose per function.
- Prefer **dataclasses** or **Pydantic models** over plain dicts for structured data.
- Use `from __future__ import annotations` for forward references (Python 3.7–3.9) or target Python 3.10+.
- Docstrings: Use Google or NumPy style consistently. All public functions, classes, and modules must have docstrings.
- Avoid mutable default arguments (`def f(items=[])` → `def f(items=None)`).

## Async & Error Handling

- Use `async/await` with `asyncio` for I/O-bound operations (FastAPI, aiohttp, etc.).
- Define custom exception classes inheriting from `Exception` for domain-specific errors. Include context.
- Never use bare `except:` — always catch specific exceptions (`except ValueError`, `except HTTPError`).
- Use context managers (`with` statement) for resource management (files, DB connections, locks).
- For FastAPI: use exception handlers and `HTTPException` with appropriate status codes. Don't let raw Python exceptions leak to API responses.

## Architecture Patterns

- **Layered architecture**: Separate routers/views → services/use-cases → repositories/data-access.
- **Dependency Injection**: FastAPI has built-in DI via `Depends()`. Django uses middleware and signals. Flask uses extensions and blueprints.
- **Repository Pattern**: Abstract data access behind a class/interface. Makes swapping databases or mocking trivial.
- **Pydantic for validation**: All external input must be validated via Pydantic models at the API boundary.
- For **Django**: follow the "fat models, thin views" pattern. Use Django's ORM idiomatically — don't fight it.
- For **FastAPI**: use routers for route grouping, dependency injection for shared logic, and background tasks for async work.
- For **Flask**: use Blueprints for modularization, Flask-SQLAlchemy for ORM, and Flask-Marshmallow for serialization.

## Testing Conventions

- **Framework**: pytest (preferred) with `pytest-asyncio` for async tests, `pytest-cov` for coverage.
- **File organization**: `tests/` directory mirroring `src/` structure — `src/services/user.py` → `tests/services/test_user.py`.
- **Naming**: `test_<behavior_description>` — e.g., `test_returns_404_when_user_not_found`.
- Use **fixtures** (`@pytest.fixture`) for test setup and teardown. Prefer factory fixtures over static data.
- Use `unittest.mock.patch` or `pytest-mock` to mock external dependencies. Never mock internal business logic.
- Use `httpx.AsyncClient` (FastAPI) or Django's `TestClient` for API integration tests.
- **Arrange-Act-Assert** pattern in every test.

## Logging

- Use Python's built-in `logging` module or `structlog` for structured logging.
- Never use `print()` for logging in production code.
- Configure logging in a central `logging_config.py` or via `dictConfig`.
- Log levels: `ERROR`, `WARNING`, `INFO`, `DEBUG` — follow Python's standard definitions.
- Include request/correlation IDs via contextvars or middleware.
- Never log secrets, tokens, passwords, or PII.

## Security

- Validate all external input via Pydantic models or Django forms. Never trust raw `request.data`.
- Use `python-dotenv` or environment variables for secrets. Never hardcode secrets.
- For passwords: use `passlib` with `bcrypt` or `argon2`. Never store plaintext.
- Keep dependencies updated — use `pip-audit` or `safety` to scan for known vulnerabilities.
- Use `CORS` middleware with explicit allowed origins (never `*` in production).
- For Django: enable CSRF protection, use `django.contrib.auth` for authentication, and follow Django's security checklist.

## Dependency Management

- Use `pyproject.toml` (PEP 621) as the single source of truth for project metadata and dependencies.
- Pin dependencies with a lockfile: `poetry.lock`, `pdm.lock`, or `pip-compile` output (`requirements.txt`).
- Separate dev dependencies from production dependencies.
- Use virtual environments (`venv`, `poetry`, `pdm`, or `conda`) — never install into the system Python.

## Common Pitfalls

- **Mutable default arguments**: `def f(items=[])` shares the same list across calls. Use `None` and create inside.
- **Circular imports**: Restructure modules or use lazy imports (`TYPE_CHECKING` for type hints only).
- **Missing `await`**: Forgetting `await` on coroutines silently returns a coroutine object instead of the result.
- **Overusing `*args, **kwargs`**: Hurts readability and type safety. Be explicit about parameters.
- **Not closing resources**: Always use `with` or `async with` for files, connections, and sessions.
