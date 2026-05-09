// SPDX-License-Identifier: MIT
//
// Dev helper: sign a v2 callback JWT for the first tenant + agent
// in the DB so you can curl /api/tools/* by hand.
//
// Connects to the dev server's embedded Postgres by URL (no
// second embedded boot). Uses the dev jwtSecret default
// ("boringos-dev-secret"). DO NOT use this outside dev.

import { signCallbackToken } from "@boringos/agent";
import { createDatabase, tenants, agents } from "@boringos/db";
import { eq, asc } from "drizzle-orm";

const pgPort = Number(process.env.PG_PORT ?? 5436);
const url = `postgres://boringos:boringos@localhost:${pgPort}/boringos`;

const conn = await createDatabase({ url });

try {
  const tenantRows = await conn.db.select().from(tenants).orderBy(asc(tenants.createdAt)).limit(1);
  const tenant = tenantRows[0];
  if (!tenant) {
    console.error("no tenants — sign up in the shell first");
    process.exit(1);
  }

  const agentRows = await conn.db
    .select()
    .from(agents)
    .where(eq(agents.tenantId, tenant.id))
    .orderBy(asc(agents.createdAt))
    .limit(1);
  const agent = agentRows[0];
  if (!agent) {
    console.error(`tenant ${tenant.id} has no agents`);
    process.exit(1);
  }

  const token = signCallbackToken(
    {
      runId: "00000000-0000-4000-8000-000000000001",
      agentId: agent.id,
      tenantId: tenant.id,
    },
    process.env.AUTH_SECRET ?? "boringos-dev-secret",
  );

  // Machine-friendly env exports (you can `eval $(node ...)`).
  console.log(`export TENANT="${tenant.id}"`);
  console.log(`export AGENT="${agent.id}"`);
  console.log(`export TOK="${token}"`);
} finally {
  await conn.close();
}
