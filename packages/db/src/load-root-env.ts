/**
 * Loads the monorepo-root `.env` for the standalone scripts in this package.
 *
 * Import this for side effects **before any other import** in a script:
 *
 *   import "./load-root-env.js";
 *
 * Why not plain `import "dotenv/config"`: that resolves `.env` against
 * `process.cwd()`, and these scripts are launched as
 * `pnpm --filter @pubky-pulse/db <script>`, whose cwd is `packages/db`. The
 * repo's only `.env` lives at the root, so nothing is loaded — leaving both
 * `DATABASE_URL` (silently falling back to a localhost URL) and `NODE_ENV`
 * undefined, which in turn makes the `NODE_ENV === "production"` abort guard in
 * the seed scripts inert on a real deployment.
 *
 * Resolving from this module's own URL is cwd-independent and works from both
 * `src/` (tsx) and `dist/` (compiled), which sit at the same depth.
 */
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env"),
  quiet: true,
});
