# Repository Guidelines

## Project Structure & Module Organization

- `apps/server/`: Fastify API, MCP endpoint, jobs, and integration tests in `src/__tests__/`.
- `apps/web/`: Next.js dashboard and Fumadocs site. Routes are in `src/app/`, UI in `src/components/`, docs in `content/docs/`, and assets in `public/`.
- `packages/db/`: Drizzle schema, migrations, partition helpers, and seeds; `packages/shared/`: shared types, constants, and tests.
- `deploy/` and `scripts/`: hosting and operational automation.

Keep domain logic in its owning workspace; use `shared` only for cross-workspace code.

## Cross-Surface Changes

Treat the REST API, MCP tools/resources, dashboard, and documentation as linked surfaces. A change to any one must trigger a review of the other three and updates wherever affected, including shared types, tests, and examples. Record this cross-surface check in pull request descriptions.

## Build, Test, and Development Commands

Use Node.js 20+, PostgreSQL 15+, and pnpm 10 (CI uses 10.33.0).

- `pnpm install`: install workspace dependencies.
- `pnpm db:migrate && pnpm dev:seed`: prepare and populate the local database.
- `pnpm dev:server` / `pnpm dev:web`: run the API on port 4000 or web app on port 3000.
- `pnpm build`: compile workspaces and build the production web bundle.
- `pnpm test`: run all Vitest suites.
- `pnpm test:coverage`: collect V8 coverage for the server.
- `pnpm db:generate <snake_case_name>`: generate a named Drizzle migration after schema changes.
- `pnpm db:check`: fail if `schema.ts` has changes with no matching migration; needs no database and runs in CI.

### Database migrations

Edit `packages/db/src/schema.ts`, run `pnpm db:generate <snake_case_name>`, read the SQL it writes into `packages/db/drizzle/`, then `pnpm db:migrate` and `pnpm test`. The name is required and must match `^[a-z][a-z0-9_]*$`; a bare `pnpm db:generate` exits with usage rather than inventing one.

Rules:

- Never add and remove columns of the same table, or tables, or enums, in a single migration. That is the only diff drizzle-kit prompts on ("created or renamed?"), and on a non-TTY the prompt hangs forever, so `db:generate` refuses it up front. Split it into two migrations — add and backfill first, drop second — which is also the production-safe way to rename.
- Never hand-edit `packages/db/drizzle/meta/*`. Those snapshots are what the next diff is computed against.
- `pnpm db:generate <name> --custom` writes an empty migration for SQL drizzle cannot express. Use it only for that, and only when `schema.ts` has no pending changes; the command refuses otherwise, because `--custom` writes a fresh snapshot while discarding the diff.
- Never edit a committed migration once it has been deployed. The drizzle migrator only applies migrations newer than the last one it recorded, so the edit is silently skipped on every database that already ran it.

`events`, `metric_events` and `funnel_events` are created `PARTITION BY RANGE ("timestamp")` in the baseline migration, while `schema.ts` declares them as ordinary tables because drizzle cannot express partitioning. So they take no primary key and no unique index that omits `timestamp`, no `.concurrently()` on their indexes (Postgres rejects concurrent index builds on a partitioned table), and no foreign keys from other tables pointing at them. Declare their indexes on the parent in `schema.ts` only — Postgres propagates a parent index to every existing and future partition, so per-partition indexes are always wrong.

A database migrated before the partitioned baseline cannot be brought forward in place; `pnpm db:migrate` fails loudly on it. Drop and recreate it (`dropdb <name> && createdb <name>`, then `pnpm db:migrate`). `pnpm dev:unsafe-reset` only truncates and will not fix it.

## Coding Style & Naming Conventions

TypeScript is strict and ESM-based. Use two-space indentation, double quotes, semicolons, trailing commas in multiline constructs, and `import type` for type-only imports. Use kebab-case filenames (`attachment-cleanup.ts`), camelCase functions/variables, and PascalCase React components/types. Server relative imports include `.js`. No repository-wide formatter or linter is configured; match neighboring files.

## Testing Guidelines

Name tests `*.test.ts` and use Vitest `describe`/`it` blocks with behavioral descriptions. Server tests connect to `TEST_DATABASE_URL`, defaulting to `postgres://localhost:5432/pubky_pulse_test`; create it with `createdb pubky_pulse_test`. The database name must end in `_test` or the test setup refuses to run. Add regression tests for route, job, schema, and permission changes.

## Commit & Pull Request Guidelines

History favors Conventional Commits such as `feat(web): ...`, `docs: ...`, and `refactor!: ...`. Use an imperative subject, optional workspace scope, and `!` only for breaking changes. Pull requests should explain intent and impact, link issues, list verification, call out migrations/configuration changes, and include screenshots for UI changes. Ensure `pnpm build` and `pnpm test` pass before review.

## Security & Configuration

Copy `.env.example` to `.env`; place `NEXT_PUBLIC_API_URL` in `apps/web/.env`. Never commit credentials, API keys, verification codes, or attachment-signing secrets. Treat `pnpm dev:unsafe-reset` as destructive and use it only against a `_test` database.
