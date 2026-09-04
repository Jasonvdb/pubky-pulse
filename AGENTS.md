# Repository Guidelines

## Project Structure & Module Organization

- `apps/server/`: Fastify API, MCP endpoint, jobs, and integration tests in `src/__tests__/`.
- `apps/web/`: Next.js dashboard and Fumadocs site. Routes are in `src/app/`, UI in `src/components/`, docs in `content/docs/`, and assets in `public/`.
- `packages/db/`: Drizzle schema, migrations, partition helpers, and seeds; `packages/shared/`: shared types, constants, and tests.
- `deploy/` and `scripts/`: hosting and operational automation.

Keep domain logic in its owning workspace; use `shared` only for cross-workspace code.

## Private Production Runbook

Instance-specific access, credentials, deployment commands, recovery procedures, and current production state belong only in the local, gitignored `PRODUCTION.md`. Read it before production work; if it is absent, ask the user. Never copy its sensitive values into tracked files, commits, pull requests, issues, or logs.

Read-only production diagnostics are permitted when needed. Obtain explicit user approval before any production deployment, migration, service restart, data mutation, or destructive operation. Never run `pnpm dev:seed` or any other `dev:seed*` command against production.

## Cross-Surface Changes

Treat the REST API, MCP tools/resources, dashboard, documentation, and official SDKs as linked surfaces. A change to any one must trigger a review of the others and updates wherever affected, including shared types, tests, and examples. For SDK-facing wire or behavior changes, review the Node.js, Swift, Android, and in-development Web SDKs. Record this cross-surface check in pull request descriptions.

For MCP capability changes, update tool/resource registration in `apps/server/src/mcp/server.ts`, `SERVER_INSTRUCTIONS`, `apps/server/src/mcp/guide.ts`, and the exhaustive `EXPECTED_*` registries in `apps/server/src/__tests__/mcp.test.ts`.

Keep `README.md` and `.env.example` aligned with configuration and operational changes. Shared conceptual prose used by multiple documentation surfaces belongs in `apps/web/content/_snippets/`; update the snippet rather than duplicating it across pages.

## Build, Test, and Development Commands

Use Node.js 20+, PostgreSQL 15+, and pnpm 10 (CI uses 10.33.0).

- `pnpm install`: install workspace dependencies.
- `pnpm db:migrate && pnpm dev:seed`: prepare and populate the local database.
- `pnpm dev:server` / `pnpm dev:web`: run the API on port 4000 or web app on port 3000.
- `pnpm build`: compile workspaces and build the production web bundle.
- `pnpm test`: run all Vitest suites.
- `pnpm test:coverage`: collect V8 coverage for the server.
- `pnpm db:generate`: generate Drizzle migrations after schema changes.

## Database Migrations

Production migrations are append-only: never edit or squash a migration that may have been applied. After `pnpm db:generate`, verify the new entry in `packages/db/drizzle/meta/_journal.json` has a `when` value greater than every prior entry; Drizzle silently skips migrations whose timestamp is not newer than the latest applied migration.

Changes to the partitioned `events`, `metric_events`, or `funnel_events` tables must also update the raw DDL in `packages/db/src/migrate.ts` and `apps/server/src/__tests__/setup.ts`, then pass the partitioned-schema parity test.

## Coding Style & Naming Conventions

TypeScript is strict and ESM-based. Use two-space indentation, double quotes, semicolons, trailing commas in multiline constructs, and `import type` for type-only imports. Use kebab-case filenames (`attachment-cleanup.ts`), camelCase functions/variables, and PascalCase React components/types. Server relative imports include `.js`. No repository-wide formatter or linter is configured; match neighboring files.

In web client code, use the `@pubky-pulse/shared` root barrel only for type imports; runtime values must use deep exports so `node:crypto` is not pulled into browser bundles. Add a package export when needed, and run `pnpm --filter @pubky-pulse/web build` after changing web imports or the shared package's public surface.

## Testing Guidelines

Name tests `*.test.ts` and use Vitest `describe`/`it` blocks with behavioral descriptions. Server tests require `postgres://localhost:5432/pubky_pulse_test`; create it with `createdb pubky_pulse_test`. The test setup performs destructive partition-table operations, so never point test helpers or `DATABASE_URL` at a non-`_test` database. Add regression tests for route, job, schema, and permission changes. Investigate failures before changing expectations; update tests only when behavior intentionally changed.

## Commit & Pull Request Guidelines

History favors Conventional Commits such as `feat(web): ...`, `docs: ...`, and `refactor!: ...`. Use an imperative subject, optional workspace scope, and `!` only for breaking changes. Pull requests should explain intent and impact, link issues, list verification, call out migrations/configuration changes, and include screenshots for UI changes. Ensure `pnpm build` and `pnpm test` pass before review.

## Security & Configuration

Copy `.env.example` to `.env`; place `NEXT_PUBLIC_API_URL` in `apps/web/.env`. Never commit credentials, API keys, verification codes, or attachment-signing secrets. Treat `pnpm dev:unsafe-reset` as destructive and use it only against a `_test` database.
