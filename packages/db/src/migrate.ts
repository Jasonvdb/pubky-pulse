import "./load-root-env.js";
import postgres from "postgres";
import { runMigrations } from "./run-migrations.js";

const url = process.env.DATABASE_URL || "postgres://localhost:5432/pubky_pulse";

async function main() {
  const client = postgres(url, { max: 1 });

  console.log("Running migrations...");
  await runMigrations(client);
  await client.end();

  console.log("Migrations complete.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
