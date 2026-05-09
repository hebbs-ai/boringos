# SKILLS.md — the Skill spec

Reference for the markdown that lands in an agent's system prompt.
Skills teach behavior; Tools provide capability. The agent reads
both on every wake.

The TypeScript types live in
[`packages/@boringos/module-sdk/src/types.ts`](packages/@boringos/module-sdk/src/types.ts).
The skill registry + provider live under
`packages/@boringos/agent/src/v2/`.

---

## What is a Skill?

```ts
interface Skill {
  id: string;
  source: SkillSource;
  body: string;
  priority?: number;
  appliesTo?: (event: SkillApplicabilityEvent) => boolean;
  requires?: string[];
}

type SkillSource =
  | "framework"
  | "module"
  | "persona"
  | "agent-instructions"
  | "tenant-override";
```

A Skill is plain markdown. The framework loads it as-is, no
templating, and concatenates it into the agent's prompt under
`## Skills`. Variables an agent needs (current task, conversation,
memory recall) come from per-run context providers, not from skill
bodies.

---

## File format

Skills can be declared two ways inside a Module's manifest:

**Inline** — a `Skill` object in `skills: []`:

```ts
skills: [
  {
    id: "memory",
    source: "module",
    body: "Use memory tools when...",
    priority: 60,
  },
]
```

**File reference** — a path to a `SKILL.md`:

```ts
skills: ["./SKILL.md"]
```

The framework reads the file at load time. Frontmatter is
optional; when present it overrides the inline fields.

### SKILL.md frontmatter

```markdown
---
id: hebbs-crm
appliesTo:
  roles: [sales-rep, admin]
priority: 100
requires:
  - hebbs-crm.create_deal
  - hebbs-crm.list_deals
---

# Hebbs CRM

The CRM tracks customer relationships through five stages: lead,
qualified, proposal, won, lost.

...
```

Frontmatter fields:

| Field | Purpose |
|---|---|
| `id` | Skill id; defaults to the Module id |
| `appliesTo.roles` | Only applies to agents with one of these roles |
| `appliesTo.taskOrigins` | Only applies when the task's `originKind` matches |
| `priority` | Order within the prompt (higher = closer to task) |
| `requires` | Tools this skill teaches; framework checks they exist |

A skill that lists a non-existent tool in `requires` fails Module
load with a clear error. This is the drift detector — if you
rename a tool and forget to update the skill, the next boot says
so.

---

## Priority and load order

Higher-priority skills appear later in the prompt, closer to the
task — so they have more influence on the agent's behavior.

Default priorities:

| Source | Default priority | Why |
|---|---|---|
| Framework built-ins (`tool-protocol`, `approvals`, `when-stuck`) | 50 | Foundational — agent reads them first |
| Module-shipped | 100 | Per-Module behavior |
| Persona module (e.g. `personas-default.cto`) | 200 | Role-specific framing |
| Per-agent instructions (`agents.instructions`) | 300 | Per-agent override |
| Tenant override (admin-curated) | 400 | Tenant has the last word |

Override the default by setting `priority` explicitly. If two
skills share a priority, registration order breaks the tie.

---

## Sources

| Source | Where it comes from |
|---|---|
| `framework` | Built-in framework SKILL.md (`packages/@boringos/agent/skills/`) |
| `module` | A Module's bundled SKILL.md or inline skill |
| `persona` | The agent's persona Module (resolved via `agents.role`) |
| `agent-instructions` | The `agents.instructions` text column |
| `tenant-override` | Admin-edited replacement in `module_skill_overrides` |

The skill registry holds them all uniformly; the prompt provider
walks the list, filters by `appliesTo`, sorts by priority, and
concatenates.

---

## appliesTo gating

Skills can opt out of irrelevant prompts. Two declarative knobs in
frontmatter:

```yaml
appliesTo:
  roles: [sales-rep, account-exec]
  taskOrigins: [crm, inbox]
```

Or a function (when declared inline in TypeScript):

```ts
appliesTo: (event) =>
  event.agentRole === "sales-rep" && event.taskOriginKind === "crm",
```

The framework evaluates `appliesTo` at prompt-build time. Skills
that don't apply are skipped — they don't consume tokens for
agents that don't need them.

`SkillApplicabilityEvent` carries:

```ts
{
  tenantId: string;
  agentId: string;
  agentRole?: string;
  taskId?: string;
  taskOriginKind?: string;
}
```

Don't reach into the DB from `appliesTo` — it runs on every wake
and should stay cheap. If you need richer gating, model it as a
separate Module that emits its own skill conditionally at load
time.

---

## Personas as Skills

Each persona is a Module that ships one or more SKILL.md files.
The agent's `role` column resolves to a persona Module id;
selecting a persona = setting the role.

Built-in personas live in
`packages/@boringos/agent/src/personas/<role>/` and ship under the
`personas-default` Module. Roles available today:

- `ceo`, `cto`, `pm`, `engineer`, `designer`, `qa`, `devops`
- `chief-of-staff`, `copilot`, `personal-assistant`
- `content-creator`, `researcher`, `finance`
- `default` (fallback for unknown roles)

Adding a persona = creating a new SKILL.md and registering a
Module that bundles it.

---

## Tenant overrides

> **Status:** Partially shipped. The v1 admin skill system
> (`/api/admin/skills`, github/url sync, per-agent attach,
> working-dir symlinks via `injectSkills`) still works alongside
> v2 today. The collapse below is the planned end state per
> task_12 §9.4.

Planned end state:

- **`module_skill_overrides` table** *(planned)* — one row per
  (tenantId, moduleId, skillId). Replaces a Module's bundled
  SKILL.md with a tenant-edited version.
- **`tenant-skills` Module** *(planned)* — wraps the overrides
  table as a pseudo-Module so the registry-walking code doesn't
  need a special case.

Per-agent attached skills (the v1 `agent_skills` join) become
per-agent instructions plus the `appliesTo: { roles: [...] }`
gating.

---

## Cross-skill linking

Refer to tools by their fully-qualified name in skill bodies:

```markdown
When you need to send an email, call `gmail.send_email` with
`{ to, subject, body }`. The response includes a `messageId` —
mention it in your follow-up comment so the user can find the
thread later.
```

> **Status:** Bundled-into-prompt is shipped — skill bodies land
> verbatim in the agent's `## Skills` section. **Boot-time
> validation** of tool references against the registry (the
> `requires` field) is the planned drift detector; today the
> field is declared but not yet checked.

---

## What good skill content looks like

A SKILL.md that earns its place in the prompt does three things:

### 1. Teach the model

```markdown
The CRM tracks deals through five stages: lead → qualified →
proposal → won → lost. A deal can move forward or skip stages,
but never backward.
```

State the domain rules the agent can't infer from the tool catalog
alone.

### 2. Teach the conventions

```markdown
Always link a deal to a contact before creating it. Contacts can
exist without deals; deals cannot exist without contacts.

Don't change deal stage in the same call as creating a contact —
split into two operations so the audit trail tells the story.
```

State the workflow rules — the things a senior teammate would
explain in onboarding.

### 3. Teach the failure modes

```markdown
If `crm.move_stage` returns `code: "conflict"`, another agent
edited the deal first. Re-read it with `crm.get_deal` and decide
whether your move still makes sense before retrying.

Never move a deal to "won" without a recent activity on the deal
— that's how stale pipeline data accumulates. Post a comment
asking the user to confirm if the last activity is over 2 weeks
old.
```

State the things that go wrong and what to do.

---

## Length and voice

- **Short.** A skill that's longer than ~200 lines is teaching
  too many things — split it.
- **Direct.** "Do X. Don't do Y." beats "It's generally a good
  practice to consider X."
- **Concrete.** Real tool names, real stage names, real errors —
  not abstractions.
- **Imperative for behavior, declarative for facts.** "Use
  `gmail.send`" not "you might want to use `gmail.send`."

---

## Examples

### Connector skill

```markdown
# google.gmail

Gmail messages are conversations. Each call to `gmail.search`
returns Message objects keyed by `id`; messages with the same
`threadId` belong to the same conversation.

## Search syntax

- `from:alice@example.com` — exact sender
- `subject:invoice` — subject contains
- `after:2026-05-01` — newer than
- `-from:me` — exclude your own sends (avoids triaging your replies)

## Sending

Use `gmail.send` for new messages. To reply in a thread, set
`threadId` on the input — Gmail keeps the conversation grouped.
Without `threadId`, your reply starts a new thread even if the
subject matches.
```

### Capability skill

```markdown
# triage

Triage classifies inbound messages into urgent / important / fyi
/ noise.

1. Call `triage.next_pending()` to get the next unread item
2. Decide a label from the rubric below
3. Call `triage.classify({ itemId, label, reason })`
4. Action based on label:
   - urgent / important: `inbox.create_task`
   - fyi: `inbox.update({ status: "read" })`
   - noise: `inbox.archive`

When in doubt between two labels, pick the higher-attention one.
False positives waste 30 seconds; false negatives miss decisions.
```

### Persona skill

```markdown
# Chief of Staff

You coordinate the org's work. You delegate, you don't execute.

When a user creates a task without a clear assignee, find the
right agent via `framework.agents.list({ filter })` and reassign
with `framework.tasks.patch({ assigneeAgentId })`. Post a comment
explaining your reasoning.

When an agent escalates a task to you with `escalate-to-boss`,
decide: handle it yourself (rare), reassign to a peer (often), or
ask the user (when you genuinely lack context).
```

---

## Anti-patterns

| Don't | Why |
|---|---|
| Embed task data in the skill body | Per-run context providers handle that; skills are static |
| Reference tools that don't exist | Framework warns at load; agent silently fails to call them |
| Use `appliesTo` for permissions | That's what tool `permissions` are for; skills control what's said, not what's allowed |
| Write a 1000-line skill | Split into multiple skills; the agent reads each on every wake |
| Repeat what other skills say | Once in the prompt is enough; duplicates burn tokens |
| Mention internal implementation details | Agents don't care that you use Drizzle; they care what to call |

---

## See also

- [`MODULES.md`](MODULES.md) — Module manifest spec
- [`TOOLS.md`](TOOLS.md) — Tool spec
- [`BUILD-A-MODULE.md`](BUILD-A-MODULE.md) — step-by-step build guide
- `packages/@boringos/agent/src/v2/skill-registry.ts` — registry source
- `packages/@boringos/agent/src/v2/skills-provider.ts` — prompt provider source
- `packages/@boringos/agent/src/personas/` — built-in persona SKILL.md set
