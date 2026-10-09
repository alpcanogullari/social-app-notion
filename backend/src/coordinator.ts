import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import path from "node:path";
import { societies } from "./seed.js";
import { defaultDataDir } from "./paths.js";

const [email, societyId] = process.argv.slice(2);
if (!email || !societies.some((s) => s.id === societyId)) {
  console.error(
    "Usage: npm run coordinator -- account@email.example society-id",
  );
  console.error("Society IDs:", societies.map((s) => s.id).join(", "));
  process.exit(1);
}
const dbPath = path.join(defaultDataDir, "vybe.sqlite");
if (!existsSync(dbPath)) {
  console.error("Start the app and create the coordinator account first.");
  process.exit(1);
}
const db = new DatabaseSync(dbPath);
try {
  const user = db
    .prepare("SELECT id FROM users WHERE email=?")
    .get(email.toLowerCase());
  if (!user) {
    console.error("Account not found. Create the account first.");
    process.exitCode = 1;
  } else {
    db.prepare("INSERT OR IGNORE INTO coordinator_roles VALUES (?, ?)").run(
      user.id,
      societyId,
    );
    console.log(
      `Coordinator access granted for ${societyId}. Refresh the app to see the control.`,
    );
  }
} finally {
  db.close();
}
