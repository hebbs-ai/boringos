# Blocker — Agents screen polish (post-cabinet rebuild)

> **Why now:** the cards-grid + org-chart + right-rail rebuild lands
> the cabinet framing and gives operators a real "edit this agent"
> surface (instructions, routing tags, reparent). It is intentionally
> v1 — several rough edges and one outright misnomer ship with it.
> This doc captures everything we deliberately deferred so the next
> pass doesn't have to re-discover the gaps.

> **Depends on:** none. All UI; backend already exposes what we need.

---

## What's already in v1

For context — the rebuild that triggered this blocker shipped:

- `packages/@boringos/shell/src/screens/Agents/` — cards grid + org
  chart toggle, fleet-stats strip, right-rail detail panel with five
  tabs (Overview, Instructions, Skills, Hierarchy, Runs).
- `packages/@boringos/ui/src/{client,hooks,index}.ts` — `getOrgTree`,
  `getSkills`, `attachSkill`, `detachSkill`, `patchAgentSkills`,
  `getV2Modules`, `getV2Installs`, plus `useAgent`, `useOrgTree`,
  `useSkills` hooks; `updateAgent` widened to include `reportsTo`,
  `skills`, `permissions`, `budgetMonthlyCents`.
- `tests/shell-agents-presenter.test.ts` — 13 tests covering the
  fleet stats / formatter / palette helpers.

The Skills tab now shows three sections: **Inherited from modules**
(read-only, fed by `/api/admin/v2/{modules,installs}`), **Routing
tags** (the editable `agents.skills` jsonb), and **Tenant skill
library** (one-click attach from `company_skills`). That's the
"honest picture" fix — agents no longer look skill-less just because
their per-agent jsonb is empty.

---

## 1. Rename "Routing tags" properly + reconcile the three skill surfaces

The biggest piece of debt this rebuild ships with. The framework has
three things called "skills" and they mean three different things:

| Thing | Where | Loaded into prompt? | Edited where? |
|---|---|---|---|
| Module skills | `Module.skills[]` in code | **Yes** — every wake | Module source files |
| `company_skills` + `agent_skills` join | tenant DB rows | **Yes** if attached | `/api/admin/skills` (no UI today) |
| `agents.skills` jsonb (string array) | per-agent column | **No** — used by `findDelegateForTask` for keyword routing | The Routing-tags section in the new Skills tab |

The new tab labels the jsonb section "Routing tags" but the column
is still named `skills`, the API is still `PATCH /agents/:id/skills`,
and the SDK still calls them skills. That mismatch will bite anyone
reading the code expecting "skills = what the agent knows."

**Two paths.** Pick one before we add any more skill-touching code:

- **(a) Rename the jsonb to `routingTags`** end-to-end: column,
  Drizzle schema, admin route, UI client, hooks, the matcher in
  `packages/@boringos/agent/src/hierarchy.ts`. Migration is a column
  rename — cheap. Keeps the word "skill" reserved for the prompt
  surfaces (modules + curated `company_skills`).
- **(b) Collapse `agents.skills` into the join table.** Stop using the
  jsonb at all; the routing matcher reads from `agent_skills` joined
  to `company_skills` and keys off `key`. Bigger schema move, but
  removes the second skill surface entirely. Aligns with the
  task_11 direction (collapse `skillMarkdown()` into literal
  `SKILL.md` files).

(a) is a day; (b) is a week. (b) is the right answer if we believe
`company_skills` becomes the single tenant-curated capability surface.

## 2. `agent_skills` join management has no UI

`/api/admin/skills/:id/attach/:agentId` and the matching DELETE exist;
the v1 Skills tab does **not** wire them. Attaching a tenant skill to
a specific agent is currently impossible from the shell — only the
free-form jsonb is editable.

To do this right we need:

- Backend: `GET /agents/:id/skills` returning the joined
  `company_skills` rows (or extend the existing `GET /agents/:id` to
  hydrate them). Today there's no read path for "which curated skills
  is this agent attached to."
- UI: in the Skills tab, the "Tenant skill library" section becomes a
  list with a toggle per skill (attached vs. available), wired to
  attachSkill / detachSkill. The free-form chip editor stays for
  routing tags (see §1).

Defer until §1 is decided — the UX depends on whether the editable
section is "routing tags" or "attached prompt skills."

## 3. Fleet header is partial

Today `FleetHeader` shows: total, running, paused, **monthly spend**.
The "today's spend" framing in the original sketch needs a real
aggregate from `agent_runs.usage_json` joined to `agents.tenantId`,
windowed to the last 24h (or `date_trunc('day', startedAt)`). Plus:

- **Errors last 24h** — count `agent_runs WHERE status='failed' AND
  startedAt > now() - 24h`. Cheap.
- **Queue depth** — pending wakes for tenant. Already exposed by
  `/api/admin/agents/:id/wake-queue`? Check; otherwise add a tenant
  aggregate.
- **Today's spend (vs. monthly)** — needs the runs aggregate above.

Add a tiny `GET /api/admin/agents/stats` returning
`{ runningNow, errors24h, spentToday, queueDepth }` for the strip,
rather than computing client-side from a full agents+runs fetch.

## 4. Activity sparkline per card

The 7-day mini-sparkline on each card is the single biggest visual
upgrade we deferred. It needs:

- A daily-bucket aggregate per agent: `runs grouped by
  date_trunc('day', startedAt) over last 7 days`.
- New endpoint, e.g. `GET /api/admin/agents/activity?window=7d`
  returning `{ agentId: { day: count } }` for the whole tenant in one
  call (we render N cards; we don't want N requests).
- A small inline bar/area component. Don't pull in a chart library
  — twelve `<div>`s with computed heights is enough.

Worth waiting until we know operators care; if "Runs" tab clicks are
high, sparkline pays off.

## 5. Custom avatars instead of initials

`avatarColor(role)` + `initials(name)` get us 80% of the way but make
every agent look like a Slack user. Two upgrades, in order:

- **Role-keyed emoji or icon**: hand-pick one icon per built-in role
  (CEO, CoS, Triage, Replier, Engineer, Designer…). Falls back to
  initials for unknown roles.
- **Per-agent custom avatar**: the column already exists
  (`agents.icon: text`). PATCH it from the right rail. URL or emoji.

## 6. Bulk actions in the grid

Operators with 20+ agents will want: "wake everyone idle", "pause the
whole cabinet", "wake all agents who report to X." None of this is
in v1. Pattern from Inbox (`BulkActionBar`) carries over:

- Multi-select (shift-range) on cards.
- Floating bottom bar with Wake / Pause / Resume.
- Backend already supports the per-agent endpoints; no new API.

## 7. Dense roster table for large fleets

The card grid feels right at 5–15 agents. At 50+ it gets wasteful.
Add a third view-toggle option: **Roster** — a table with avatar,
name, role, status, last-seen, monthly spend, todos. Keep the
right-rail detail behavior identical. Most code stays the same; only
the list renderer changes.

Don't build until a host actually has 50+ agents. Premature.

## 8. Live-updating without page refresh

`useAgents` is set to `refetchInterval: 5000` and `useOrgTree` to
`10000`. That's fine for most cases but for an agent that's actively
running we want **streamed status changes** so the pulse-dot starts
in real time. The framework has SSE on `/api/events`; the shell
already wires `client.subscribe` for inbox/tasks. Hook the same
stream and invalidate the agents query on `agent:status_changed` /
`run:started` / `run:finished` events.

Not a v1 blocker — but the polling will feel laggy as soon as anyone
demos the screen.

## 9. Org-chart layout when the tree is wide

`OrgChart.tsx` renders a vertical indented list. Works for shallow
trees and small orgs. For a 30-person cabinet across three layers it
gets visually noisy. Options when this hurts:

- **Collapse** subtrees per node (chevron toggle).
- **Real graph layout** with `@xyflow/react` (already a dep — used
  by Workflows). Heavier, but gives drag-to-reparent for free.

## 10. Reparent confirmation + warnings

The Hierarchy tab lets you change `reportsTo` with a single dropdown
+ Save. The backend rejects cycles and self-parenting; the dropdown
also filters descendants. But:

- No confirmation dialog when reparenting an agent that has direct
  reports — moving Maya re-roots her whole subtree under the new
  manager (cascade is fine, but the operator should *see* it).
- No undo. We could surface the previous parent in a toast for 5s.

Low priority but cheap.

## 11. New-agent flow

The grid has no "+ New agent" affordance. `createAgent` exists in the
client; we'd need a small modal asking name + role + runtime. The
templates registry (`createAgentFromTemplate`, `BUILT_IN_TEAMS`) is
the right backbone — the modal can offer "from template" (12 personas,
5 team templates) or "blank."

This is deliberately deferred: most v1 hosts have agents seeded by
provisioning + apps, and "create one from the UI" is the rare path.
But it's the obvious next button.

## 12. Permissions surface

`agents.permissions` is jsonb with no UI today and no contract. The
right-rail Overview tab could expose it as a simple key/value editor
once we agree on the shape. Until then, leave it.

## 13. Smoke test gap

`tests/shell-agents-presenter.test.ts` covers the pure helpers. There
is no integration test that exercises the full screen — clicking a
card opens the panel, editing instructions saves, reparenting fires
the right PATCH. The Inbox screen has the same gap; this is a broader
shell-testing-strategy decision, not specific to Agents. Flag once we
pick an integration approach (Playwright on the dev server is the
cheapest).

---

## Suggested next slice

If we touch this screen again, do these in order — small wins first:

1. **§1(a)**: rename `agents.skills` → `agents.routingTags`.
   One-day refactor, removes the worst conceptual debt.
2. **§3**: tenant `/agents/stats` endpoint + wire the fleet header.
   Makes the strip honest.
3. **§8**: SSE-driven invalidation. Demos better than polling.
4. **§5**: role-keyed icons. Cheap visual upgrade.
5. **§4**: sparklines. Skip if §3+§8 already give the activity
   feeling we want.

Everything else is genuinely "later when a user asks."
