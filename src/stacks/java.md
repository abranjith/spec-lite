# Java / Spring — Best Practices & Conventions

> Curated by spec-lite. **Edit this file freely** to match your project — your changes are preserved across `spec-lite update`. The `/memorize bootstrap` agent reads this file as its starting baseline.

## Coding Standards

- Follow the **Google Java Style Guide** (or your team's agreed-upon variant). Enforce with Checkstyle or Spotless in CI.
- **Naming**: `camelCase` for methods/variables, `PascalCase` for classes/interfaces/enums, `UPPER_SNAKE_CASE` for constants. Packages are all lowercase (`com.example.myapp`).
- **File naming**: One top-level public class per file. File name must match the class name (`UserService.java`).
- Use **Java 17+** features where possible: records, sealed classes, pattern matching, text blocks.
- Prefer `final` for variables, parameters, and fields by default. Mutate only when there's a clear reason.
- Prefer `Optional<T>` over returning `null`. Never pass `Optional` as a method parameter.
- Use **Lombok** judiciously — `@Slf4j`, `@Builder`, `@Value` are helpful; avoid `@Data` on JPA entities (breaks equals/hashCode).
- Javadoc on all public classes and methods. Include `@param`, `@return`, and `@throws` tags.
- Keep methods short and focused — one responsibility per method. If a method exceeds ~30 lines, refactor.

## Spring Boot Patterns

- Use **constructor injection** exclusively — no field injection (`@Autowired` on fields). Let Spring auto-detect single-constructor beans.
- Organize by **feature/domain**, not by layer. Prefer `user/UserController.java`, `user/UserService.java` over `controllers/UserController.java`, `services/UserService.java`.
- Use `@RestController` + `@RequestMapping` for REST APIs. Return `ResponseEntity<T>` for explicit status codes.
- Use **Spring profiles** (`application-{profile}.yml`) for environment-specific configuration. Never hard-code secrets or URLs.
- Externalize configuration with `@ConfigurationProperties` over scattered `@Value` annotations.
- Use `@Transactional` at the service layer, not on controllers or repositories. Keep transactions as short as possible.
- Prefer **Spring Data JPA** repositories with derived query methods. Fall back to `@Query` for complex queries, and native queries only as a last resort.
- Use **DTOs** to decouple API contracts from domain entities. Map with MapStruct or manual mapping — avoid exposing JPA entities directly in APIs.

## Error Handling

- Define a `@RestControllerAdvice` global exception handler. Map domain exceptions to appropriate HTTP status codes.
- Create custom exception classes that extend `RuntimeException` (e.g., `ResourceNotFoundException`, `BusinessRuleException`).
- Never catch `Exception` or `Throwable` broadly. Catch specific exceptions and handle them meaningfully.
- Use **Problem Details** (RFC 9457 / `application/problem+json`) for structured error responses.
- Validate inputs with **Bean Validation** (`@Valid`, `@NotBlank`, `@Size`, etc.) at the controller layer.

## Architecture Patterns

- **Layered architecture**: Controller → Service → Repository. Controllers handle HTTP concerns, services contain business logic, repositories handle persistence.
- For complex domains, consider **hexagonal architecture**: domain core has no Spring/JPA dependencies, adapters connect to infra.
- Use **interfaces** for services when there are multiple implementations or when you need to decouple for testing (otherwise, concrete classes are fine).
- Avoid the **anemic domain model** — put behavior on domain entities where it belongs, not only in services.
- Use **events** (`ApplicationEventPublisher`) to decouple cross-cutting concerns (audit, notifications) from core business logic.

## Testing

- Use **JUnit 5** with **AssertJ** for fluent assertions and **Mockito** for mocking.
- Follow the pattern: `@ExtendWith(MockitoExtension.class)` for unit tests, `@SpringBootTest` for integration tests.
- Use **`@WebMvcTest`** for controller-layer tests (fast, no full context). Use **`@DataJpaTest`** for repository-layer tests with an embedded database (H2 or Testcontainers).
- Use **Testcontainers** for integration tests against real databases, message brokers, or external services.
- **Naming**: `should_doSomething_when_condition()` or `givenX_whenY_thenZ()`. Be descriptive.
- Aim for high coverage on service/domain logic. Don't unit-test trivial getters or Spring-generated code.
- Use `@DirtiesContext` sparingly — prefer test isolation through transactions or test data builders.

## Logging & Observability

- Use **SLF4J** (`@Slf4j` with Lombok, or `LoggerFactory.getLogger()`). Never use `System.out.println()`.
- Log levels: `ERROR` for failures needing attention, `WARN` for recoverable issues, `INFO` for business events, `DEBUG` for diagnostic detail.
- Use **structured logging** with Logback + JSON encoder (or Log4j2) for production. Include correlation IDs.
- Use **Spring Boot Actuator** for health checks, metrics, and info endpoints. Expose `/actuator/health` and `/actuator/prometheus` for monitoring.
- Add **Micrometer** metrics for custom business KPIs (e.g., orders processed, cache hit ratio).

## Security

- Use **Spring Security** with sensible defaults. Configure via `SecurityFilterChain` bean (not by extending `WebSecurityConfigurerAdapter` — deprecated).
- Use **BCrypt** (`BCryptPasswordEncoder`) for password hashing. Never store passwords in plain text.
- Enable **CSRF protection** for browser-based apps. Disable only for stateless APIs with token-based auth.
- Validate and sanitize all inputs. Use parameterized queries (JPA/Hibernate handles this) — never concatenate user input into SQL.
- Keep dependencies up to date. Use `mvn versions:display-dependency-updates` or Dependabot/Renovate.
- Store secrets in environment variables or a vault (Spring Cloud Vault, AWS Secrets Manager). Never commit secrets to source control.

## Dependency Management

- Use **Maven** (with `pom.xml`) or **Gradle** (with `build.gradle.kts` — prefer Kotlin DSL). Pick one and be consistent.
- Use the **Spring Boot BOM** (`spring-boot-starter-parent` or `spring-boot-dependencies`) to manage dependency versions. Don't override Spring-managed versions unless absolutely necessary.
- Keep the dependency tree lean. Audit with `mvn dependency:tree` or `gradle dependencies`.
- Pin plugin and dependency versions explicitly. Avoid `LATEST` or `RELEASE` version ranges.
