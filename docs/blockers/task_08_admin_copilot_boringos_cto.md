# Blocker (parked) — Admin Copilot in the Admin tab

**Status:** parked. Revisit after `task_07` (unified tool catalog,
shipped) is consumed by the user-scoped Copilot cleanup, and after the
admin tab in the shell is built out enough to host a thread.

## The model

Every user gets **two Copilots**, threaded in two different surfaces:

- **User Copilot** — default, available to everyone (admin and staff
  alike). Lives in the user's main thread / chat surface. Acts with
  the user's scope. Helps with personal work: emails, tasks, reading
  CRM data, drafting replies, scheduling. Same Copilot whether the
  user is admin or staff.
- **Admin Copilot** ("BoringOS CTO" or similar) — only available to
  users with `role: admin`. Lives in a separate **Admin tab** thread.
  Acts with tenant-wide admin scope. Helps with operational work:
  install/uninstall apps, manage agents, change settings, manage
  routines and budgets, review audit log, invite team members.

**The point of the split is the surface, not the privilege.** Even
for a single human who is both an admin and a normal user (the most
common case), the two copilots are intentionally separate threads:

- Different mental contexts → different conversations. "Send Mira
  the pricing email" belongs in the user thread; "pause all agents
  for the holiday weekend" belongs in the admin thread.
- Cleaner audit trail. Every message in the admin thread is, by
  construction, an admin operation. Every message in the user thread
  isn't. No more sifting one log to figure out what was operational
  vs personal.
- Reduces accidental admin operations during normal work. Asking
  your user Copilot "delete that thing" doesn't reach the admin
  surface even by mistake.
- Lets each Copilot have its own persona, its own tool catalog, its
  own approval discipline, without compromising either.

A non-admin user only ever sees the User Copilot. The admin tab —
and therefore the Admin Copilot — is invisible to them.

## What this task will cover (do not implement now)

### Agent + scope

- **New built-in agent role:** `admin-copilot` (or `boringos-cto`).
  Source `shell`, distinct persona. Created per tenant; addressable
  by all admins of that tenant.
- **Admin-scoped JWT.** When the engine wakes the admin Copilot,
  sign a per-run JWT with admin claims (not the raw admin key).
  Admin middleware accepts it the same way as `X-API-Key`. Cleanly
  expirable, per-run scoped, audit-attributable to the agent run.
- **Tool catalog (already built by `task_07`).** Admin Copilot's
  prompt includes the same generated `## Available tools` section,
  but extended to include admin endpoints (`/api/admin/*`,
  `/api/auth/team`, `/api/auth/invite`, etc.) gated behind admin
  role. The connector-actions catalog and app-route catalog are
  shared with the user Copilot.
- **No codebase access by default.** The persona's old "read/edit
  code" claim is *not* part of this task. Self-hosted/dev tenants
  can opt in via config; managed cloud doesn't.

### Persona

Admin Copilot's persona is operationally focused:
- Knows the tenant's settings model, its routines, its budgets, its
  installed apps, its audit log shape.
- Defaults to summarising tenant state on greet ("3 agents running,
  1 paused; budget at 67% for the month; 2 routines failing").
- Draft-then-confirm posture for destructive operations
  (uninstalling an app, deleting an agent, mass-update settings).
- Persona makes the surface explicit: "you are the admin Copilot
  for {tenant}; your conversations happen in the admin tab; you
  do not handle personal user work — that's the user Copilot's
  job."

### Surface

- **Admin tab** in the shell hosts a single thread with the admin
  Copilot. Tab visible only to users with `role: admin` in the
  active tenant.
- Thread UI is the same affordance as the main user Copilot thread
  (one continuous conversation; tasks, comments, work products,
  approvals all attach to the thread's task chain).
- Approvals raised by the admin Copilot for destructive ops show
  up in the same approvals surface admins already use, with a
  clear "from admin Copilot" attribution.
- Per-tenant audit log gets the admin Copilot's runs surfaced
  prominently — one click from the admin tab.

### Lifecycle

- **Seed** — when a tenant is provisioned, create the admin Copilot
  alongside CoS and the (system) initial Copilot. Source `shell`,
  reportsTo the CoS structurally.
- **Per-admin or per-tenant?** *Per-tenant.* Multi-admin tenants
  share one admin Copilot thread. The thread is the operational
  control room; the audit trail is one stream; multiple admins
  can drop in. (Avoids quorum questions, simplifies state.)
- **Non-deletable.** Same protection as CoS / user Copilot —
  framework primitive, can't be removed.
- **Pause-on-no-admins.** If a tenant has no admin user (admin
  resigns / leaves), pause the admin Copilot until a new admin
  exists. Don't delete; resume cleanly when admin reappears.

### Approvals

- Destructive admin ops always route through the existing
  approvals table and surface in the approvals UI. Approver must
  be a *human admin* (not the agent). The agent posts a comment +
  `proposed_params` snapshot per `task_07` discipline.
- Reads (list agents, list routines, get audit log, get budget
  status) are free.
- Writes (create agent, update settings, install app, invite team
  member, change cron) gated by approval, with a per-tenant
  configurable list of "auto-approve for admins" actions for
  routine ops the tenant trusts.

## Dependencies

- **`task_07` (unified tool catalog, shipped)** — admin Copilot
  reuses the same catalog provider, just with an extended set of
  endpoints visible because of admin scope.
- **Hierarchy + provenance task (active)** — admin Copilot is a
  `source='shell'` agent under CoS, structurally tied to the
  tenant root.
- **User-scoped Copilot cleanup (proposed)** — establishes the
  pattern of per-run scoped JWTs carrying actor identity. Admin
  JWT reuses the same minting path with an extra claim for admin
  role.
- **Admin tab in the shell** — the surface has to exist before
  the Copilot has a home. If the admin tab is being designed
  separately, treat the Copilot thread as a first-class section
  of that tab from day one, not a retrofit.

## Open questions (for when this unparks)

- **Naming.** "Admin Copilot" is descriptive but bland;
  "BoringOS CTO" is evocative but locks us into a metaphor.
  Decide before persona authoring — the persona reads very
  differently if it's "the CTO" vs "the admin assistant."
- **Hierarchy position.** Under CoS, peer to user Copilot? Under
  CoS, peer to CoS? Lean: under CoS, peer to user Copilot — both
  are framework primitives, both report to CoS for coordination,
  neither outranks the other.
- **Cross-tab handoff.** If a user is in the user Copilot thread
  and asks an admin operation ("pause agents"), should the user
  Copilot say "switch to the admin tab for that" (clean separation)
  or transparently delegate to the admin Copilot via the hierarchy
  (single-thread feel, blurry audit)? Lean: explicit, "switch to
  admin tab" — keeps the audit clean and reinforces the surface.
- **Approval routing for solo-admin tenants.** If the only admin
  is the human asking the admin Copilot to do something, who
  approves the destructive op? Either self-approve (with a clear
  "you're approving your own request" UX) or fast-path with
  per-action confirmation in-thread. Lean: in-thread inline
  confirm for solo-admin, queue-approval for multi-admin where
  another admin reviews.
- **Codebase access.** Defer until a real product need surfaces;
  almost certainly belongs to a self-hosted developer tenant
  experience, not the default cloud product.
- **Connector visibility.** Should the admin Copilot see all
  connector credentials (scopes, tokens, last sync errors), while
  user Copilot only sees the action surface? Lean: yes — admin
  Copilot needs to debug connector health; user Copilot doesn't.
  Schema gating, not framework gating.

## Why this is a blocker (eventually)

The everyday Copilot is the wrong place for tenant-wide
operational work, even when the human at the keyboard is an
admin. Mixing operational requests into a personal-work thread
muddies audit, increases the blast radius of an accidental
prompt, and forces a single persona to span "draft my emails"
and "uninstall the CRM app." The two-Copilot split keeps each
surface coherent.

Until the admin tab + admin Copilot ship, admins either (a) curl
the admin API by hand (which is what `task_04` is solving on the
UI side) or (b) ask their user Copilot to do admin things —
which their user Copilot can't do, by design. That's an okay
gap to live with for now (admins are a small fraction of users
and `task_04` is closing the UI side), but it's the natural
endpoint of where this product is going.
