/**
 * Non-interactive wrapper around `drizzle-kit generate`.
 *
 * Lives outside `src/` on purpose: `tsconfig.json` sets `rootDir: src`, so a
 * file here is run by tsx but never compiled into `dist/`.
 *
 * Two problems it solves:
 *
 * 1. Bare `drizzle-kit generate` names migrations randomly (`0001_sloppy_vertigo`).
 *    A name is required here and validated as snake_case, because `--name`
 *    with an empty value silently produces `0001_undefined`.
 * 2. drizzle-kit prompts "created or renamed?" (via hanji) whenever one diff
 *    both adds and removes columns of the same table, or both adds and removes
 *    tables or enums. On a non-TTY stdin that prompt does not fail, it hangs
 *    forever. We reproduce the exact predicate from drizzle-kit's
 *    `promptColumnsConflicts` / `promptNamedConflict` (both return early when
 *    either side of the diff is empty) against the snapshots, and fail fast
 *    with an actionable message instead. drizzle-kit is then spawned with
 *    stdin ignored, so even an unforeseen prompt cannot wait on input.
 *
 * Usage: tsx scripts/generate.ts <snake_case_name> [--custom] [--check]
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "../src/schema.js";

// drizzle-kit 0.30.x ships a broken ESM build of `drizzle-kit/api` (it calls
// `require` from an .mjs bundle). Load the CommonJS build instead.
const require = createRequire(import.meta.url);
const { generateDrizzleJson } = require("drizzle-kit/api") as {
  generateDrizzleJson: (imports: Record<string, unknown>) => Snapshot;
};

type Snapshot = {
  tables?: Record<string, { columns?: Record<string, unknown> }>;
  enums?: Record<string, unknown>;
};

type Journal = {
  entries?: { idx: number; tag: string; when: number }[];
};

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DRIZZLE_DIR = join(PACKAGE_DIR, "drizzle");
const JOURNAL_PATH = join(DRIZZLE_DIR, "meta", "_journal.json");
const DRIZZLE_KIT_BIN = join(dirname(require.resolve("drizzle-kit/api")), "bin.cjs");

const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const NO_CHANGES = "No schema changes";
const NEEDS_GIT = "--check requires a git working tree (it reverts whatever drizzle-kit writes).";

const USAGE = [
  "Usage: pnpm db:generate <snake_case_name> [--custom]",
  "",
  "  <snake_case_name>  required, matches /^[a-z][a-z0-9_]*$/ (e.g. add_event_locale)",
  "  --custom           write an empty migration for SQL drizzle cannot express;",
  "                     refused unless schema.ts is already fully generated",
  "  --check            report drift without writing anything (used by CI)",
].join("\n");

function usageExit(message: string): never {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(2);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readJournal(): Journal {
  if (!existsSync(JOURNAL_PATH)) return {};
  return JSON.parse(readFileSync(JOURNAL_PATH, "utf8")) as Journal;
}

/** The journal's exact bytes, or undefined if it does not exist yet. */
function readJournalText(): string | undefined {
  if (!existsSync(JOURNAL_PATH)) return undefined;
  return readFileSync(JOURNAL_PATH, "utf8");
}

function lastEntry(journal: Journal): { idx: number; tag: string } | undefined {
  const entries = journal.entries ?? [];
  return entries[entries.length - 1];
}

/** The snapshot the next migration will be diffed against. */
function previousSnapshot(): Snapshot {
  const entry = lastEntry(readJournal());
  if (!entry) return {};
  const path = join(DRIZZLE_DIR, "meta", `${String(entry.idx).padStart(4, "0")}_snapshot.json`);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as Snapshot;
}

function names(record: Record<string, unknown> | undefined): string[] {
  return Object.keys(record ?? {});
}

/** Strip the schema prefix drizzle uses in snapshot keys (`public.events`). */
function short(key: string): string {
  const dot = key.indexOf(".");
  return dot === -1 ? key : key.slice(dot + 1);
}

function partition(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: after.filter((key) => !beforeSet.has(key)),
    removed: before.filter((key) => !afterSet.has(key)),
  };
}

/**
 * Every place drizzle-kit would stop and ask "created or renamed?".
 * Returns one human-readable line per conflict; empty means safe to generate.
 */
function promptConflicts(prev: Snapshot, cur: Snapshot): string[] {
  const conflicts: string[] = [];

  const tables = partition(names(prev.tables), names(cur.tables));
  if (tables.added.length > 0 && tables.removed.length > 0) {
    conflicts.push(
      `tables: added ${tables.added.map(short).join(", ")}; removed ${tables.removed.map(short).join(", ")}`,
    );
  }

  const enums = partition(names(prev.enums), names(cur.enums));
  if (enums.added.length > 0 && enums.removed.length > 0) {
    conflicts.push(
      `enums: added ${enums.added.map(short).join(", ")}; removed ${enums.removed.map(short).join(", ")}`,
    );
  }

  for (const key of names(cur.tables)) {
    const before = prev.tables?.[key];
    if (!before) continue;
    const columns = partition(names(before.columns), names(cur.tables?.[key]?.columns));
    if (columns.added.length > 0 && columns.removed.length > 0) {
      conflicts.push(
        `table "${short(key)}": added column(s) ${columns.added.join(", ")}; removed column(s) ${columns.removed.join(", ")}`,
      );
    }
  }

  return conflicts;
}

type Run = { status: number; stdout: string };

/**
 * stdin is ignored so a prompt can never wait on input; stderr is inherited so
 * drizzle-kit's own errors reach the terminal unchanged.
 */
function runDrizzleKit(args: string[]): Run {
  const result = spawnSync(process.execPath, [DRIZZLE_KIT_BIN, ...args], {
    cwd: PACKAGE_DIR,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.error) fail(`Failed to run drizzle-kit: ${result.error.message}`);
  const stdout = result.stdout ?? "";
  if (stdout) process.stdout.write(stdout);
  if (result.signal) fail(`drizzle-kit was killed by ${result.signal}`);
  return { status: result.status ?? 1, stdout };
}

/** Path of the migration a run just wrote, or undefined if it wrote none. */
function migrationWrittenSince(before: { tag: string } | undefined): string | undefined {
  const after = lastEntry(readJournal());
  if (!after) return undefined;
  if (before && before.tag === after.tag) return undefined;
  return join(DRIZZLE_DIR, `${after.tag}.sql`);
}

function git(args: string[], cwd: string): { status: number; stdout: string } {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? "" };
}

/** Working-tree state of `drizzle/`, as repo-root-relative path -> status code. */
function drizzleStatus(): Map<string, string> {
  const { status, stdout } = git(["status", "--porcelain", "-uall", "--", "drizzle"], PACKAGE_DIR);
  if (status !== 0) fail(NEEDS_GIT);
  const entries = new Map<string, string>();
  for (const line of stdout.split("\n")) {
    if (line.length < 4) continue;
    entries.set(line.slice(3).trim(), line.slice(0, 2));
  }
  return entries;
}

/**
 * Undo only what this run created; anything already dirty beforehand is left
 * alone. Returns the paths it reverted.
 */
function revertCheckArtifacts(before: Map<string, string>, repoRoot: string): string[] {
  const reverted: string[] = [];
  for (const [path, code] of drizzleStatus()) {
    if (before.has(path)) continue;
    if (code === "??") {
      rmSync(join(repoRoot, path), { force: true });
    } else {
      git(["checkout", "--", path], repoRoot);
    }
    reverted.push(path);
  }
  return reverted;
}

function main(): void {
  const args = process.argv.slice(2);
  const flags = args.filter((arg) => arg.startsWith("-"));
  const positionals = args.filter((arg) => !arg.startsWith("-"));

  const unknown = flags.filter((flag) => flag !== "--custom" && flag !== "--check");
  if (unknown.length > 0) usageExit(`Unknown option: ${unknown[0]}`);
  if (positionals.length === 0) usageExit("A migration name is required.");
  if (positionals.length > 1) usageExit(`Expected one migration name, got: ${positionals.join(" ")}`);

  const name = positionals[0];
  if (!NAME_PATTERN.test(name)) {
    usageExit(`Invalid migration name "${name}": use snake_case (lowercase letters, digits, underscores).`);
  }

  const custom = flags.includes("--custom");
  const check = flags.includes("--check");

  const conflicts = promptConflicts(previousSnapshot(), generateDrizzleJson(schema));
  if (conflicts.length > 0) {
    fail(
      [
        "This diff both adds and removes the same kind of object:",
        ...conflicts.map((line) => `  - ${line}`),
        "",
        "drizzle-kit would prompt 'created or renamed?'. Split into two migrations: add-and-backfill, then drop.",
      ].join("\n"),
    );
  }

  if (check) {
    const repoRoot = git(["rev-parse", "--show-toplevel"], PACKAGE_DIR).stdout.trim();
    if (!repoRoot) fail(NEEDS_GIT);
    const before = drizzleStatus();
    const journalText = readJournalText();
    const run = runDrizzleKit(["generate", "--name", name]);
    const journalChanged = readJournalText() !== journalText;
    const reverted = revertCheckArtifacts(before, repoRoot);

    // The git-based revert deliberately skips paths that were already dirty, so
    // a journal a developer had mid-edit would keep the `ci_drift_check` entry
    // drizzle-kit appended to it. Restoring the bytes we read is unconditional
    // and correct either way: when the journal was clean the checkout above
    // already produced exactly these bytes.
    if (journalChanged && journalText !== undefined) {
      writeFileSync(JOURNAL_PATH, journalText);
    }

    if (run.status !== 0) process.exit(run.status);
    if (journalChanged || reverted.length > 0 || !run.stdout.includes(NO_CHANGES)) {
      fail(
        "Migration drift: schema.ts has changes with no matching migration.\n" +
          "Run `pnpm db:generate <snake_case_name>` and commit the generated SQL and snapshot.",
      );
    }
    console.log("No migration drift: schema.ts matches the latest snapshot.");
    return;
  }

  const journalBefore = lastEntry(readJournal());
  const run = runDrizzleKit(["generate", "--name", name]);
  if (run.status !== 0) process.exit(run.status);
  const written = migrationWrittenSince(journalBefore);

  if (!custom) {
    if (written) console.log(`Generated ${written}`);
    return;
  }

  // --custom discards the diff while still writing the snapshot, so pending
  // schema.ts edits would be lost forever. Only allow it on a generated tree.
  if (written || !run.stdout.includes(NO_CHANGES)) {
    fail(
      `Refusing --custom: schema.ts had pending changes, now written to ${written ?? "a new migration"}.\n` +
        "Review and commit that migration, then re-run with --custom.",
    );
  }

  const customRun = runDrizzleKit(["generate", "--custom", "--name", name]);
  if (customRun.status !== 0) process.exit(customRun.status);
  const customWritten = migrationWrittenSince(journalBefore);
  if (customWritten) console.log(`Generated ${customWritten}`);
}

main();
