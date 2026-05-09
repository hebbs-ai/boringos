import type { ContextProvider, ContextBuildEvent } from "../types.js";

const MAX_PEERS = 10;
const MAX_SKIP_LEVEL = 8;

export function createHierarchyProvider(deps: { db: unknown }): ContextProvider {
  return {
    name: "hierarchy",
    phase: "system",
    priority: 15, // after header (0), before tenant guidelines (20)

    async provide(event: ContextBuildEvent): Promise<string | null> {
      try {
        const { eq: eqOp, and, ne, inArray } = await import("drizzle-orm");
        const { agents } = await import("@boringos/db");
        const db = deps.db as import("@boringos/db").Db;

        const agent = event.agent;
        const lines: string[] = ["## Your Organization"];

        // Find boss
        let bossId: string | null = null;
        if (agent.reportsTo) {
          const bossRows = await db.select().from(agents).where(eqOp(agents.id, agent.reportsTo)).limit(1);
          if (bossRows[0]) {
            bossId = bossRows[0].id;
            lines.push(`- **You report to:** ${bossRows[0].name} (${bossRows[0].role})`);
            lines.push(`- When stuck or blocked, escalate to your manager.`);
          }
        } else {
          // Task 07: Chief of Staff is organizational root
          if (agent.role === "chief-of-staff") {
            lines.push(`- You are the **Chief of Staff** — the organizational root.`);
            lines.push(`- Everyone in the team reports to you (directly or through your reports).`);
            lines.push(`- Coordinate decisions, route work, unblock your reports.`);
          } else {
            lines.push(`- You are a **top-level agent** with no manager.`);
          }
        }

        // Find direct reports
        const reports = await db.select().from(agents).where(eqOp(agents.reportsTo, agent.id));
        if (reports.length > 0) {
          lines.push(`- **Your direct reports:**`);
          for (const r of reports) {
            const tags = Array.isArray((r as any).routingTags) ? ((r as any).routingTags as string[]) : [];
            const tagsLabel = tags.length > 0 ? ` — tags: ${tags.slice(0, 4).join(", ")}` : "";
            lines.push(`  - ${r.name} (${r.role}) — ${r.status}${tagsLabel}`);
          }
          lines.push(`- When a task is too large or outside your expertise, delegate to your reports.`);
          lines.push(`- Create subtasks and assign them. Don't do everything yourself.`);
        }

        // Find peers (siblings that share the same boss, if any)
        if (bossId) {
          const peers = await db.select().from(agents).where(
            and(eqOp(agents.reportsTo, bossId), ne(agents.id, agent.id)),
          );
          const eligiblePeers = peers.filter((p) => p.status !== "archived");
          if (eligiblePeers.length > 0) {
            lines.push(`- **Your colleagues (peers):**`);
            for (const p of eligiblePeers.slice(0, MAX_PEERS)) {
              const tags = Array.isArray((p as any).routingTags) ? ((p as any).routingTags as string[]) : [];
              const tagsLabel = tags.length > 0 ? ` — tags: ${tags.slice(0, 4).join(", ")}` : "";
              const pausedLabel = p.status === "paused" ? " [paused]" : "";
              lines.push(`  - ${p.name} (${p.role})${tagsLabel}${pausedLabel}`);
            }
            if (eligiblePeers.length > MAX_PEERS) {
              lines.push(`  - … and ${eligiblePeers.length - MAX_PEERS} more`);
            }
            lines.push(`- When a task fits a peer better than you, hand it off rather than doing it yourself.`);
          }
        }

        // Skip-level (reports' reports) — so a manager sees one level deeper
        if (reports.length > 0) {
          const reportIds = reports.map((r) => r.id);
          const skipLevel = await db.select().from(agents).where(inArray(agents.reportsTo, reportIds));
          const eligibleSkip = skipLevel.filter((a) => a.status !== "archived");
          if (eligibleSkip.length > 0) {
            lines.push(`- **Skip-level reports (your reports' reports):**`);
            for (const s of eligibleSkip.slice(0, MAX_SKIP_LEVEL)) {
              lines.push(`  - ${s.name} (${s.role})`);
            }
            if (eligibleSkip.length > MAX_SKIP_LEVEL) {
              lines.push(`  - … and ${eligibleSkip.length - MAX_SKIP_LEVEL} more`);
            }
          }
        }

        // Only return if there's actual hierarchy info
        if (lines.length <= 1) return null;

        return lines.join("\n");
      } catch {
        return null;
      }
    },
  };
}
