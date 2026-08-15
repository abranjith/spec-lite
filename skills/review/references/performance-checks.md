# Performance Checks

## Establish the Critical Path

Identify user-visible or throughput-critical flows, expected scale, SLAs, likely time distribution (I/O, database, network, computation, serialization, GC), and available profiler/APM/benchmark evidence. Do not optimize startup or rare paths as though they were request hot paths.

Use a compact flow when helpful, for example: `request → auth (measured 2 ms) → query (measured 45 ms) → serialize (estimated 8 ms)`.

## Review Dimensions

- **Algorithms:** avoid unnecessary quadratic work, repeated full scans, and recursion/recomputation without bounds.
- **I/O/network:** flag N+1 queries, unbatched calls, blocking I/O, missing pooling, and chatty protocols.
- **Memory:** flag loop allocations, leaks, unbounded caches/collections, and loading unbounded datasets.
- **Concurrency:** inspect lock contention, pool exhaustion, blocking async work, races, and needless serialization.
- **Caching:** validate benefit, bounds, invalidation, tenancy, and consistency—not merely cache absence.
- **Database:** inspect indexes, scans, joins, over-fetching, pagination, query count, and transaction scope.
- **Frontend:** where applicable, inspect bundle size, render blocking, re-renders, images, hydration, and layout work.

## Evidence Rules

Label every quantitative claim **Measured**, **Estimated**, or **Unknown**. Include source/tool/sample conditions for measured data. High severity requires critical-path relevance plus measured impact or strong scale-based reasoning; do not elevate micro-optimizations.

## Quick Wins and Baselines

Call out two or three low-complexity, meaningful improvements separately when present. Preserve baselines in this form when data exists:

| Metric | Current | Target | Evidence | Status |
|---|---:|---:|---|---|
| p99 latency / throughput / memory / bundle / batch duration | value | SLA | profiler/APM/benchmark | pass/fail |

Recommendations must state the expected benefit, confidence, complexity/tradeoff, and how to verify it. Prefer measurement/monitoring before architectural optimization.
