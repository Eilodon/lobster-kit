# Package Boundaries And Source Of Truth

## Purpose
Define strict package ownership so Eidolon can evolve from a DeFi-first product into a universal agent OS without code drift.

## Current Package Roles
| Package | Role | Source of Truth |
| --- | --- | --- |
| `@eidolon/core` | Domain primitives, interfaces, shared utilities, event bus, metrics | Core contracts and reusable abstractions |
| `@eidolon/soul` | Agent cognition, emotional model, guard logic, swarm behavior | Brain and soul runtime |
| `@eidolon/toolkit` | Concrete execution toolkit and external capability wiring | Action body and adapters for domains |
| `packages/mcp-rust` | Public MCP runtime (Rust stdio server) | Universal interface layer |
| `@eidolon/defi-bnb` | DeFi-specific adapter surface and migration compatibility | Domain adapter (legacy + focused DeFi use) |

## Architectural Guardrails
1. `mcp` must only orchestrate via `toolkit`/`soul` public APIs and never duplicate execution logic.
2. Domain logic belongs in adapters (`defi-bnb` now, future `game-adapter`, `research-adapter`, etc.), not in `core`.
3. `core` cannot import from `soul`, `toolkit`, or domain adapters.
4. Cross-package imports must always be declared in package runtime dependencies.
5. If the same module exists in multiple packages, choose one owner and deprecate the duplicate path.

## Drift Prevention
- Run `pnpm check:deps` locally and in CI.
- The checker scans `packages/*/src` and fails when a workspace package is imported without a declared runtime dependency.
- This prevents hidden coupling and broken production builds.
- Run `pnpm sync:integration-mirrors` after changing source-of-truth files that are intentionally mirrored for test harness compatibility.
- Run `pnpm sync:integration-mirrors:check` in CI (or pre-push) to fail fast when mirror files drift.
- Run `pnpm audit:duplicates` to inspect exact-content duplicates across `packages/*/src` (the report ignores intentional test mirrors and one-line re-export wrappers).

## Intentional Mirrors (Test Harness)
- `packages/integration-tests/src` keeps a small set of mirrored source files so `vi.mock('../src/...')` keeps working deterministically.
- Source of truth remains in owner packages (`core`, `soul`, `toolkit`, `defi-bnb`); mirrors are synced via `scripts/sync-integration-mirrors.mjs`.
- Do not replace these mirrors with package re-export wrappers unless corresponding tests are rewritten away from local path mocking.

## Phase-1 Status (Adapter Registry)
- `@eidolon/toolkit` now exposes `DomainAdapterRegistry` for domain-agnostic action routing.
- `@eidolon/toolkit` stays domain-agnostic and does **not** ship built-in domain adapters.
- Runtime hosts (`packages/mcp-rust`, apps, workers) must register domain adapters explicitly (for example `@eidolon/defi-bnb` -> `OpBnbDefiAdapter`).
- MCP runtime calls domain actions through adapter contracts instead of hard-coding module internals.

## Next Refactor Targets
1. Split DeFi-specific services in `toolkit` into `defi-bnb` adapters behind stable interfaces.
2. Add adapter registry in `toolkit` so new domains can plug in without changing `mcp`.
3. Keep `soul` domain-agnostic by passing capabilities through interfaces (`IEidolon` or successor contracts).
