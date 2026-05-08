# Rust — Best Practices & Conventions

> Curated by spec-lite. **Edit this file freely** to match your project — your changes are preserved across `spec-lite update`. The `/memorize bootstrap` agent reads this file as its starting baseline.

## Coding Standards

- Run **`cargo fmt`** on all code — never argue about formatting, let the tool handle it. Enforce in CI with `cargo fmt --check`.
- Run **`cargo clippy --all-targets -- -D warnings`** in CI. Treat clippy lints as part of the review surface, not optional polish.
- **Naming**: `snake_case` for functions, variables, modules, and crates; `PascalCase` for types, traits, and enum variants; `SCREAMING_SNAKE_CASE` for constants and statics. Lifetimes are short, lowercase: `'a`, `'src`.
- **Acronyms**: treat as words — `HttpClient`, not `HTTPClient`; `parse_url`, not `parse_URL`.
- **File naming**: `snake_case.rs`. One module per file is the default; use `mod.rs` or `module_name.rs` consistently across the crate.
- Prefer **borrowed types for arguments**: `&str` over `&String`, `&[T]` over `&Vec<T>`, `&T` over `&Box<T>`. Lets callers pass either an owned or borrowed value cheaply.
- Use the **`Default` trait** for zero-arg construction. Derive `#[derive(Default)]` when all fields implement it. Provide a `new()` constructor as well — Rust users expect it.
- Use the **builder pattern** when construction has many optional fields or side effects. Consider `derive_builder` to cut boilerplate.
- Use the **newtype pattern** (`struct Password(String);`) to add type safety, override traits like `Display`, or hide implementation types in public APIs.
- Use `#[non_exhaustive]` on public structs and enums when you anticipate adding fields/variants in a backwards-compatible way. Use sparingly — bumping the major version is often clearer.
- Default to writing **no comments**. Doc comments (`///`) on public items only. Prefer well-named identifiers and types over inline explanations.

## Ownership, Borrowing & Lifetimes

- **Don't `.clone()` to satisfy the borrow checker.** It hides a design problem and silently doubles work. Diagnose the borrow conflict first; clone only when ownership genuinely needs to be shared.
- For shared ownership, reach for `Rc<T>` (single-threaded) or `Arc<T>` (multi-threaded) — these clone cheaply by bumping a refcount. Use `Arc<Mutex<T>>` / `Arc<RwLock<T>>` for shared mutable state across threads.
- Use `mem::take` and `mem::replace` to move owned values out of `&mut` references (e.g., when transitioning enum variants) instead of cloning.
- **Decompose large structs** when the borrow checker complains about whole-struct borrows — splitting into smaller structs lets fields be borrowed independently and often yields a cleaner design.
- Use **RAII guards** (a struct with a `Drop` impl) for resource cleanup that must run on all exit paths — locks, transactions, file handles, temp files. Mutex's `MutexGuard` is the canonical example.
- Prefer **temporary mutability**: shadow `let mut x` with `let x = x;` once mutation is done, so the compiler enforces immutability for the rest of the scope.

## Error Handling

- Return `Result<T, E>` from any fallible function. Use `?` to propagate. Reserve `panic!` / `unwrap` / `expect` for truly impossible states or test code.
- For libraries: define a concrete error enum (often with `thiserror`). For applications: use `anyhow::Result` + `anyhow::Context` for ergonomic error chaining.
- Implement `std::error::Error` (or derive via `thiserror`) on custom error types so they compose cleanly with the wider ecosystem.
- **Return consumed arguments on error** when a fallible function takes ownership — e.g., `Err(SendError(value))` — so callers can retry without re-cloning. The standard library does this with `String::from_utf8` / `FromUtf8Error::into_bytes`.
- Wrap upstream errors with context (`.with_context(|| ...)` in anyhow, or `#[from]` / `#[source]` in thiserror) — never silently swallow them.
- Don't use `unwrap()` in production code paths. `expect("invariant: ...")` is acceptable when the invariant is documented and load-bearing.

## Concurrency

- **`Send` and `Sync` are checked by the compiler** — let the type system tell you what's safe to share. Don't fight it with `unsafe impl` unless you know exactly what invariants you're upholding.
- Use `std::thread::spawn` for OS threads and `tokio` / `async-std` for async runtimes. Don't mix runtimes in one project.
- **Channels over shared state when possible**: `std::sync::mpsc`, `crossbeam-channel`, or `tokio::sync::{mpsc, oneshot, broadcast}`. Communicate by sending messages.
- For shared mutable state, use `Arc<Mutex<T>>` (or `parking_lot::Mutex` for performance) or `Arc<RwLock<T>>`. Always release the guard quickly — never hold a lock across `.await`.
- Use `tokio::sync::Mutex` (not `std::sync::Mutex`) when the lock is held across `.await` points, otherwise the future won't be `Send`.
- Use **scoped threads** (`std::thread::scope`) when threads need to borrow non-`'static` data — avoids the `Arc` ceremony for short-lived parallelism.
- Avoid `unsafe` for concurrency primitives — prefer crates like `crossbeam`, `parking_lot`, or `dashmap` that have been audited.

## Architecture Patterns

- **Use traits, not inheritance.** The Strategy pattern in Rust is just a trait with multiple impls. There is no class hierarchy — composition + traits cover the use cases.
- Keep traits **small and focused** — `Read`, `Write`, `Iterator`, `Display` style. Composable single-responsibility traits enable generic code.
- **Generics + trait bounds give you type classes.** Two `Vec<T>` with different `T` are different types — use this to encode states/protocols at compile time and eliminate runtime checks.
- Introduce a **custom trait to simplify complex bounds** when you find yourself repeating long `where` clauses (especially involving `Fn` traits with specific output types). Provide a blanket `impl` for types satisfying the original bound.
- **Prefer small crates** that do one thing well. Cargo and crates.io make this cheap. Watch out for "dependency hell" — pin major versions, audit transitive deps with `cargo audit`.
- Use `pub(crate)` and `pub(super)` to keep visibility tight. `pub` items are part of your semver contract.
- For visitor-style traversal of heterogeneous data (ASTs, config trees), use the **visitor pattern** with a trait. For producing a transformed copy, use the **fold pattern**.
- **Anti-pattern: Deref polymorphism.** Don't implement `Deref<Target = SomeOtherType>` to fake inheritance — `Deref` is for smart pointers, not for sharing methods between unrelated types.
- **Anti-pattern: `#![deny(warnings)]` in published crates.** New compiler/clippy versions will break downstream builds. Prefer `RUSTFLAGS="-D warnings"` in CI, or deny specific lints.

## Async Specifics

- An `async fn` returns a `Future` — nothing runs until it's `.await`ed or driven by an executor (`tokio::spawn`, `block_on`, etc.).
- **Don't hold synchronous locks (`std::sync::Mutex`) across `.await`.** Use `tokio::sync::Mutex` if you must, but prefer redesigning to scope the lock tightly.
- Use `tokio::spawn` for fire-and-forget concurrent tasks. Use `tokio::join!` / `try_join!` for parallel-and-await. Use `tokio::select!` for racing futures.
- Cancellation is **cooperative** — futures are dropped at `.await` points. Make sure resources cleanup correctly via `Drop` rather than assuming the future will run to completion.
- Use `Stream` (from `futures` or `tokio_stream`) for async iteration. `StreamExt::next().await` is the analog of `Iterator::next()`.

## Testing Conventions

- **Framework**: built-in. Tests live in `#[cfg(test)] mod tests { ... }` blocks alongside source, or in `tests/` for integration tests. Run with `cargo test`.
- Use `#[test]` for sync tests and `#[tokio::test]` (or your runtime's equivalent) for async tests.
- Use `assert_eq!`, `assert!`, `assert_ne!`. For complex equality, consider `pretty_assertions` for readable diffs.
- **Property-based testing** with `proptest` or `quickcheck` for invariant checking on generated inputs.
- For mocking, prefer **trait-based seams + hand-written test doubles** over heavyweight mocking crates. `mockall` is fine when you really need it.
- **Doc tests**: `///` examples in fenced ` ```rust ` blocks are run by `cargo test`. Use them to verify the public API stays usable. Use `# ` prefix to hide setup lines.
- Use `#[should_panic(expected = "...")]` for tests that verify panic conditions. Avoid in normal code paths.
- Run `cargo test --all-features` and `cargo test --no-default-features` if you have feature flags, to catch feature-gated regressions.

## Logging & Observability

- Use the **`tracing` ecosystem** (`tracing`, `tracing-subscriber`) for structured, leveled, span-aware logging. It's the de facto standard, especially in async code where context matters.
- For simpler libraries, the **`log`** facade is acceptable — but applications usually want `tracing` for span-tracked correlation.
- **Levels**: `error!` (failures), `warn!` (recoverable issues), `info!` (key events), `debug!` (diagnostics), `trace!` (verbose).
- Attach structured fields (`tracing::info!(user_id = %id, "login")`) instead of formatting into the message — preserves them for downstream tools.
- Never log secrets, tokens, passwords, or PII. Use newtype wrappers (e.g., `Password`) with custom `Display` / `Debug` impls to redact at compile time.
- For metrics, use `metrics` (with a backend like `metrics-exporter-prometheus`) or OpenTelemetry via `opentelemetry` + `tracing-opentelemetry`.

## Security

- Validate and sanitize all external input at system boundaries. Use `serde` with strict types and `#[serde(deny_unknown_fields)]` where appropriate.
- Use `rustls` (pure-Rust TLS) over `native-tls` when feasible — fewer C dependencies, predictable behavior across platforms.
- Use `rand` from the `rand` crate; for cryptographic randomness use `rand::rngs::OsRng` or `getrandom` directly. Never roll your own crypto — prefer `ring`, `dalek`, or audited crates.
- Use parameterized queries with `sqlx`, `diesel`, or `sea-orm`. Never format SQL with user input.
- Run `cargo audit` in CI to catch known vulnerabilities in dependencies. Run `cargo deny` to enforce license, source, and advisory policies.
- **Contain `unsafe` in small modules** — wrap unsafe operations behind a safe interface, document the invariants the caller must uphold, and audit the boundary carefully. Read [Ralf Jung's blog on unsafe invariants](https://www.ralfj.de/blog/) for the foundations.
- Store secrets in environment variables or a secrets manager — never commit them. Crates like `secrecy` provide types that prevent accidental logging.

## FFI (when applicable)

- Design FFI APIs **object-based**: encapsulated types are owned by Rust and opaque to the foreign caller; transactional types are owned by the foreign caller and transparent. Use opaque pointers for handles.
- Minimize the size of `unsafe` blocks. Convert raw pointers and C strings (`CStr` / `CString`) into safe Rust types as early as possible.
- For accepting C strings, use `CStr::from_ptr(ptr).to_str()?` — borrow rather than copy. Document required caller invariants in `# Safety` doc sections on `unsafe fn`.
- For passing strings, keep `CString` alive long enough — assign it to a `let` binding before calling the FFI function. Don't inline `.as_ptr()` into the call (the temporary drops immediately).
- Convert errors at the boundary: flat enums → integer codes; structured enums → integer code + error message accessor; custom error types → `#[repr(C)]` mirror struct.

## Common Pitfalls

- **`String` vs `&str`**: take `&str` in function arguments unless you genuinely need ownership. `String` arguments force callers to allocate or clone.
- **Iterator vs collection**: working with iterators (`.map`, `.filter`, `.collect`) is usually faster and more idiomatic than building intermediate `Vec`s.
- **`unwrap()` in production**: a panic in a library is a footgun for users. Return `Result` and let callers decide.
- **Holding a `MutexGuard` longer than needed**: the guard is dropped at end of scope. If you compute a value while holding the lock, extract it into a local and drop the guard explicitly with `drop(guard)`.
- **`Cell` / `RefCell` borrow panics**: `RefCell::borrow_mut()` panics at runtime if there's an outstanding borrow. Keep `borrow()` / `borrow_mut()` scopes short.
- **Integer overflow**: in release mode, overflow wraps silently. Use `checked_add`, `wrapping_add`, `saturating_add`, or `overflowing_add` to be explicit. Enable `overflow-checks = true` in release for safety-critical code.
- **`async` recursion**: an `async fn` cannot recurse directly (infinite-sized future). Box the recursive call: `Box::pin(async move { ... })`.
- **Lifetimes in returned references**: returning `&T` from a method ties the reference's lifetime to `&self`. If you need a longer-lived reference, return owned data or use `Arc<T>` / `Rc<T>`.
- **`#[derive(Clone)]` on large types**: derived `Clone` is recursive. For large or expensive-to-clone types, consider `Arc<T>` for shared ownership instead.
- **Forgetting `#[must_use]`**: annotate functions returning `Result` or other types where ignoring the result is a likely bug. The compiler will warn callers who drop the value.
