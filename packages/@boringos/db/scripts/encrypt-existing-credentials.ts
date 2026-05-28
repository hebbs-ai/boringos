// SPDX-License-Identifier: AGPL-3.0-or-later
//
// One-shot migration: encrypt any connectors rows that still hold plaintext
// credentials from before the Task 0.2 deployment.
//
// This script uses raw SQL so it does NOT depend on the Drizzle schema for
// the legacy connectors table (which was deleted in Task 2.11). It is a
// Phase 0 script and should be run BEFORE migrate-connectors-to-accounts.ts,
// which should in turn be run BEFORE the Task 2.11 DROP TABLE migration.
//
// Run once per environment after deploying the encryption change:
//
//   BORINGOS_ENCRYPTION_KEY=<hex> DATABASE_URL=<url> \
//     pnpm --filter @boringos/db tsx scripts/encrypt-existing-credentials.ts
//
// The script is idempotent:
//   - Rows already encrypted (string value in `credentials`) are skipped.
//   - Rows with NULL credentials are skipped.
//   - Plaintext objects are encrypted and written back.

import postgres from "postgres";
import { packCredentials } from "../src/credentials.js";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL not set");

  const client = postgres(databaseUrl, { onnotice: () => {} });

  // Check whether the legacy connectors table still exists.
  const tableCheck = await client<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'connectors'
    ) AS exists
  `;
  if (!tableCheck[0]?.exists) {
    console.log("Legacy connectors table does not exist -- nothing to encrypt.");
    await client.end();
    return;
  }

  const rows = await client<Array<{
    id: string;
    credentials: string | Record<string, unknown> | null;
  }>>`
    SELECT id, credentials FROM connectors
  `;

  let encrypted = 0;
  let skipped = 0;

  for (const row of rows) {
    if (typeof row.credentials === "string") {
      // Already encrypted. Skip.
      skipped++;
      continue;
    }
    if (!row.credentials) {
      // NULL. Nothing to encrypt.
      skipped++;
      continue;
    }
    // Plain object: encrypt and write back.
    const sealed = packCredentials(row.credentials as Record<string, unknown>);
    await client`
      UPDATE connectors SET credentials = ${sealed} WHERE id = ${row.id}
    `;
    encrypted++;
  }

  console.log(`Encrypted ${encrypted} rows. Skipped ${skipped}.`);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
