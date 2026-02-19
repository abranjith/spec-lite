# .NET / C# — Best Practices & Conventions

> Curated by spec-lite. **Edit this file freely** to match your project — your changes are preserved across `spec-lite update`. The `/memorize bootstrap` agent reads this file as its starting baseline.

## Coding Standards

- Follow the **Microsoft C# Coding Conventions** and **.NET naming guidelines**.
- **Naming**: `PascalCase` for types, methods, properties, events, and namespaces. `camelCase` for local variables and parameters. `_camelCase` for private fields. `I` prefix for interfaces (`IUserRepository`).
- Use **nullable reference types** (`<Nullable>enable</Nullable>`) and treat all warnings as errors.
- Prefer `var` for local variables when the type is obvious from the right-hand side. Use explicit types when clarity is needed.
- Use `record` types for immutable data (DTOs, value objects). Use `class` for entities with behavior.
- Use `readonly` and `const` by default. Avoid mutable state unless necessary.
- XML documentation comments (`///`) on all public APIs. Include `<summary>`, `<param>`, `<returns>`, and `<exception>` tags.
- Keep methods short and focused — one responsibility per method. If a method exceeds ~30 lines, refactor.
- Use `file-scoped namespaces` (C# 10+) and `global using` directives for common imports.

## Async & Error Handling

- Use `async/await` for all I/O-bound operations. Never block on async code (`Task.Result`, `.Wait()`).
- Use `CancellationToken` on all async methods and pass it through the call chain.
- Define custom exception classes for domain-specific failures. Include context (what failed, why, correlation ID).
- Never catch `Exception` broadly — catch specific exceptions. Re-throw with `throw;` (not `throw ex;`) to preserve stack traces.
- Use **Result pattern** (or libraries like `FluentResults`, `OneOf`) for expected failures that aren't exceptional.
- For ASP.NET Core: use global exception handling middleware or `IExceptionHandler` (NET 8+). Don't scatter `try/catch` in controllers.

## Architecture Patterns

- **Clean Architecture**: Domain → Application → Infrastructure → Presentation. Dependencies point inward.
- **SOLID principles**: Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, Dependency Inversion.
- **Dependency Injection**: Use the built-in `IServiceCollection` / `IServiceProvider`. Register services with appropriate lifetimes (`Singleton`, `Scoped`, `Transient`).
- **Repository + Unit of Work**: Abstract data access behind interfaces. Use EF Core's `DbContext` as the Unit of Work.
- **MediatR or Wolverine** for CQRS / mediator pattern — decouple controllers from business logic.
- **Options pattern** (`IOptions<T>`, `IOptionsSnapshot<T>`) for strongly-typed configuration.
- For **Minimal APIs** (NET 7+): use endpoint groups and filters for clean organization.
- For **Controllers**: keep them thin — delegate to services/handlers. Controllers should only handle HTTP concerns.

## Testing Conventions

- **Framework**: xUnit (preferred) or NUnit + FluentAssertions for readable assertions.
- **File organization**: Separate test project per source project — `MyApp.Domain` → `MyApp.Domain.Tests`.
- **Naming**: `MethodName_Scenario_ExpectedResult` — e.g., `GetUser_WhenUserNotFound_Returns404`.
- **Arrange-Act-Assert (AAA)** pattern in every test.
- Use `Moq`, `NSubstitute`, or `FakeItEasy` for mocking interfaces. Mock at the boundary — never mock internal classes.
- Use `WebApplicationFactory<T>` for ASP.NET Core integration tests.
- Use **test fixtures** (`IClassFixture<T>`) for expensive setup (DB, HTTP clients). Avoid per-test setup overhead.
- Use `Bogus` or `AutoFixture` for test data generation.

## Logging

- Use the built-in `ILogger<T>` interface (Microsoft.Extensions.Logging). Never use `Console.WriteLine` in production.
- Use **structured logging** with Serilog (preferred) or NLog as the provider.
- Log levels: `Critical`, `Error`, `Warning`, `Information`, `Debug`, `Trace` — follow Microsoft severity definitions.
- Include correlation IDs via `Activity` or custom middleware.
- Use **log message templates** with named placeholders: `logger.LogInformation("User {UserId} created order {OrderId}", userId, orderId)`.
- Never log secrets, connection strings, tokens, or PII.
- Configure log sinks (console, file, Seq, Application Insights) via `appsettings.json`.

## Security

- Validate all input via **Data Annotations**, **FluentValidation**, or model binding validation. Never trust raw input.
- Use **ASP.NET Core Identity** or a proven auth library for authentication. Don't roll your own.
- Enforce authorization with `[Authorize]` attributes and policy-based authorization.
- Store secrets in **Azure Key Vault**, **User Secrets** (dev), or environment variables. Never in `appsettings.json` committed to source control.
- Use **HTTPS** everywhere. Enforce with `UseHttpsRedirection()` and HSTS middleware.
- For passwords: use `PasswordHasher<T>` (ASP.NET Identity) which uses PBKDF2. For custom hashing, use `Argon2`.
- Keep NuGet packages updated — use `dotnet list package --vulnerable` to check.

## Entity Framework Core Conventions

- Keep `DbContext` configurations in separate `IEntityTypeConfiguration<T>` classes.
- Use **migrations** for schema changes. Never modify the database manually.
- Prefer **AsNoTracking** for read-only queries.
- Use **projection** (`Select`) for queries that don't need full entities — avoid loading unnecessary data.
- Configure **global query filters** for soft deletes and multi-tenancy.
- Avoid lazy loading in web applications — use eager loading (`Include`) or explicit loading.

## Common Pitfalls

- **Blocking on async**: `Task.Result` or `.Wait()` causes deadlocks in ASP.NET. Always `await`.
- **Service lifetime mismatches**: Injecting a `Scoped` service into a `Singleton` captures a stale instance. Use `IServiceScopeFactory` instead.
- **Missing `CancellationToken`**: Not passing tokens means requests can't be cancelled, wasting resources.
- **N+1 queries**: Loading related entities in a loop. Use `Include()` or projection to batch.
- **Throwing exceptions for control flow**: Exceptions are expensive. Use Result pattern for expected failures.
- **Over-abstraction**: Don't create interfaces for every class. Only abstract at boundaries (repositories, external services, infrastructure).
