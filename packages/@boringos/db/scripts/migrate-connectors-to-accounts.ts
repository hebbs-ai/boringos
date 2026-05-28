// SPDX-License-Identifier: AGPL-3.0-or-later
//
// One-shot data migration: copies rows from the legacy connectors table into
// connector_accounts. Idempotent. Safe to re-run.
//
// This script uses raw SQL so it does NOT depend on the Drizzle schema for
// the legacy connectors table (which was deleted in Task 2.11). It must be
// run BEFORE the Task 2.11 schema migration (DROP TABLE connectors) lands
// in the target environment. After the drop, this script becomes a no-op
// because the table will not exist.
//
// Prerequisites:
//   1. Deploy the schema migration adding connector_accounts table.
//   2. Run encrypt-existing-credentials.ts first so every connectors row has
//      an encrypted string in the credentials column.
//   3. Run this script.
//   4. Deploy the Task 2.11 migration (DROP TABLE connectors).
//
// Usage:
//   DATABASE_URL=<url> pnpm --filter @boringos/db tsx scripts/migrate-connectors-to-accounts.ts
//
// Idempotency: the unique constraint on (tenant_id, provider, account_id) plus
// ON CONFLICT DO NOTHING means re-running is safe and will not create duplicates.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { connectorAccounts } from "../src/schema/connector-accounts.js";

// Best-effort scope backfill for known providers.
// These match the ConnectorDefinition.scopes fields in @boringos/connector-google
// and @boringos/connector-slack. Rows migrated here reflect the maximum scope set
// that the platform would have requested at OAuth time.
const KNOWN_SCOPES: Record<string, string[]> = {
  google: [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar",
    "openid",
    "email",
    "profile",
  ],
  slack: [
    "chat:write",
    "channels:read",
    "groups:read",
    "reactions:write",
    "reactions:read",
  ],
};

interface LegacyConnectorRow {
  id: string;
  tenant_id: string;
  kind: string;
  status: string;
  config: Record<string, unknown> | null;
  credentials: string | Record<string, unknown> | null;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL not set");

  const client = postgres(databaseUrl, { onnotice: () => {} });
  const db = drizzle(client);

  // Check whether the legacy connectors table still exists. If it was already
  // dropped (Task 2.11 migration ran first), skip gracefully.
  const tableCheck = await client<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'connectors'
    ) AS exists
  `;
  if (!tableCheck[0]?.exists) {
    console.log("Legacy connectors table does not exist -- nothing to migrate.");
    await client.end();
    return;
  }

  // Raw query so this script has no compile-time dependency on the deleted schema file.
  const rows = await client<LegacyConnectorRow[]>`
    SELECT id, tenant_id, kind, status, config, credentials FROM connectors
  `;

  let migrated = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!row.credentials) {
      // NULL credentials -- nothing useful to migrate.
      skipped++;
      continue;
    }

    // After Phase 0 (Task 0.2 / 0.3) credentials must be an encrypted string.
    // If it's still a plain object the operator needs to run
    // encrypt-existing-credentials.ts first.
    if (typeof row.credentials !== "string") {
      console.warn(
        `Skipping row ${row.id} (provider: ${row.kind}): credentials is still a` +
          ` plaintext object. Run encrypt-existing-credentials.ts first.`,
      );
      skipped++;
      continue;
    }

    // Derive a stable accountId from the config JSON stored alongside the token.
    let accountId = "default";
    const config = (row.config ?? {}) as Record<string, unknown>;

    if (row.kind === "google") {
      accountId = (config.email as string | undefined) ?? "default";
    } else if (row.kind === "slack") {
      accountId = (config.team_id as string | undefined) ?? "default";
    }

    await db
      .insert(connectorAccounts)
      .values({
        tenantId: row.tenant_id,
        provider: row.kind,
        accountId,
        authStrategy: "oauth2",
        status: row.status ?? "active",
        credentials: row.credentials,
        grantedScopes: KNOWN_SCOPES[row.kind] ?? [],
        profile: config as Record<string, unknown> | null,
      })
      .onConflictDoNothing();

    migrated++;
  }

  console.log(`Migrated ${migrated} rows. Skipped ${skipped}.`);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
