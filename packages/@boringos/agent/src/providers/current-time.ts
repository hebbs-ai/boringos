// SPDX-License-Identifier: MIT
//
// Current-time context provider.
//
// Every agent wake gets the absolute current time injected near the
// top of its system prompt. This is "ambient context" — every agent
// (copilot, triage, replier, chief-of-staff, …) reasons about time
// constantly (today, this week, 3 hours ago, schedule for next
// Monday), and putting the answer right in the prompt removes the
// "I don't have access to the current time" failure mode.
//
// Resolution ladder for the timezone:
//   1. tenant_settings.timezone   (future per-tenant override)
//   2. process.env.TZ              (host-level)
//   3. Intl-resolved system zone   (the OS's setting)
//   4. "UTC" fallback
//
// Format: ISO-ish absolute + human-readable line. Compact (~5 lines).
//
// Time is read at prompt-build time, so it's always fresh-at-run-start
// even for queued wakes that sat in the queue for a few seconds. Mid-
// run freshness (a model thinking for 8 minutes) is out of scope here
// — handled separately by a `framework.now()` tool when needed.

import { sql } from "drizzle-orm";
import type { Db } from "@boringos/db";
import type { ContextProvider, ContextBuildEvent } from "../types.js";

interface Options {
  db?: Db;
  /** Override the clock for tests / determinism. Defaults to Date. */
  now?: () => Date;
}

async function resolveTimezone(db: Db | undefined, tenantId: string): Promise<string> {
  // 1. Tenant override (column doesn't exist yet — query is a no-op
  //    today, but lives here so the day someone adds the row, this
  //    just starts working).
  if (db) {
    try {
      const rows = await db.execute(sql`
        SELECT value FROM tenant_settings
         WHERE tenant_id = ${tenantId} AND key = 'timezone'
         LIMIT 1
      `);
      const v = (rows as unknown as Array<{ value: string }>)[0]?.value;
      if (typeof v === "string" && v.length > 0) return v;
    } catch {
      // Column or row missing — fall through.
    }
  }
  // 2. Host env.
  if (process.env.TZ) return process.env.TZ;
  // 3. Intl-resolved.
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function format(date: Date, tz: string): { iso: string; weekday: string; dateOnly: string; humanTime: string } {
  // We render against the tenant's timezone, not the server's local
  // zone. Intl handles this without pulling moment/date-fns.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "long",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const part = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const yyyy = part("year");
  const mm = part("month");
  const dd = part("day");
  const HH = part("hour");
  const MM = part("minute");
  const weekday = part("weekday");
  return {
    iso: `${yyyy}-${mm}-${dd}T${HH}:${MM}`,
    humanTime: `${HH}:${MM}`,
    weekday,
    dateOnly: `${yyyy}-${mm}-${dd}`,
  };
}

export function createCurrentTimeProvider(opts: Options = {}): ContextProvider {
  const clock = opts.now ?? (() => new Date());
  return {
    name: "current-time",
    phase: "system",
    // Very early in the system block — right after `header` (priority 0)
    // so it precedes persona, skills, guidelines, etc.
    priority: 1,

    async provide(event: ContextBuildEvent): Promise<string> {
      const tz = await resolveTimezone(opts.db, event.tenantId);
      const now = clock();
      const f = format(now, tz);
      return [
        `## Current time`,
        `- **Now:** ${f.iso} ${tz}`,
        `- **Today:** ${f.dateOnly} (${f.weekday})`,
        `- **Local time:** ${f.humanTime} ${tz}`,
        ``,
        `Use this when reasoning about "today", "this week", "3 hours ago",`,
        `scheduling, deadlines, or anything time-relative. Don't claim you`,
        `lack access to the time — it's right here.`,
      ].join("\n");
    },
  };
}
