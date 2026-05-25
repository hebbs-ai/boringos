# BoringOS

![BoringOS — The Operating System for AI](./poster.png)

> The operating system for agents. You ship Modules; the agent
> reads skills and calls tools. Everything else is plumbing.

BoringOS is an open-source framework for building agentic
platforms — agents receive tasks, execute autonomously via CLI
subprocesses (Claude Code, Codex, Gemini CLI, Ollama, …), and
report back. The framework never calls LLM APIs directly; CLIs
are the agents, BoringOS is the orchestrator.

> **The thesis in one read:** [`docs/thesis.md`](docs/thesis.md) —
> what Hebbs is, what ships on day zero (the Shell), what you
> install on top (Modules), how the framework works, and how we
> sell. Read this first, and use it as the source of truth when
> writing any new doc or marketing copy.

---

## Product tour

A guided walk through what BoringOS actually looks like running. First the **Shell** (the operating system surface), then a **CRM module example** showing how an installable module extends it. Tap **Next →** to swipe through.

**Jump to a section:**
[Shell](#1-executive-brief) · [Install a module](#7-modules--before-install) · [CRM module example](#9-pipeline--deals-by-stage)

---

### Shell — the operating system

#### 1. Executive brief

> Run the company from one screen: open work, agents online, weekly spend, and the watch items that need a decision today.

![Executive brief](./repo-assets/home.png)

[Next →](#2-tasks--operating-units-of-work) · [↑ Tour](#product-tour)

---

#### 2. Tasks — operating units of work

> Every task names its owner, blockers, decisions needed, and risks. Comments are the audit trail. This is how a CEO reads work.

![Task detail](./repo-assets/task_detail.png)

[← Prev](#1-executive-brief) · [Next →](#3-copilot--ask-and-get-decision-ready-output) · [↑ Tour](#product-tour)

---

#### 3. Copilot — ask and get decision-ready output

> "Build me a Tesla account brief." Copilot returns a progress chart, the decision committee, and a ready-to-send email — not a chat transcript.

![Copilot](./repo-assets/copilot.png)

[← Prev](#2-tasks--operating-units-of-work) · [Next →](#4-agents--your-cabinet) · [↑ Tour](#product-tour)

---

#### 4. Agents — your cabinet

> A real operating cabinet: Chief of Staff at the top; GTM, RevOps, and Engineering pods underneath. Twelve named operators, one chart, clear accountability.

![Agents org chart](./repo-assets/agents_org.png)

[← Prev](#3-copilot--ask-and-get-decision-ready-output) · [Next →](#5-workflows--repeatable-execution-with-traces) · [↑ Tour](#product-tour)

---

#### 5. Workflows — repeatable execution with traces

> Complex workflows (e.g. enterprise deal qualification) run end-to-end with a span tree on the right. Execution is repeatable and inspectable.

![Workflow run drawer](./repo-assets/workflows_run.png)

[← Prev](#4-agents--your-cabinet) · [Next →](#6-budgets--ai-spend-with-guardrails) · [↑ Tour](#product-tour)

---

#### 6. Budgets — AI spend with guardrails

> Tenant cap, per-team caps, spend by agent and by model. No surprises at the end of the month.

![Budgets](./repo-assets/budgets.png)

[← Prev](#5-workflows--repeatable-execution-with-traces) · [Next →](#7-modules--before-install) · [↑ Tour](#product-tour)

---

### Install a module

#### 7. Modules — before install

> The platform ships with the core operating system. New surface areas (sales, support, finance) arrive as signed `.hebbsmod` packages.

![Modules pre-install](./repo-assets/modules_pre.png)

[← Prev](#6-budgets--ai-spend-with-guardrails) · [Next →](#8-modules--after-install) · [↑ Tour](#product-tour)

---

#### 8. Modules — after install

> One click installs the CRM module. Pipeline, Deals, Contacts, and Companies appear instantly in the left nav — the org now has a sales surface.

![Modules post-install](./repo-assets/modules_post.png)

[← Prev](#7-modules--before-install) · [Next →](#9-pipeline--deals-by-stage) · [↑ Tour](#product-tour)

---

### CRM module example — sales operations on the shell

#### 9. Pipeline — deals by stage

> Board-level visibility: every named account, every value, every owner, every stage. The view a CEO opens before the board call.

![Pipeline](./repo-assets/pipeline.png)

[← Prev](#8-modules--after-install) · [Next →](#10-contact-dossier--research-grade-context) · [↑ Tour](#product-tour)

---

#### 10. Contact dossier — research-grade context

> Persona, journey, recognition, alerts (TPU v5, LangChain redlines), sourced citations. The brief an AE actually reads before the meeting.

![Contact dossier](./repo-assets/contact_dossier_intel.png)

[← Prev](#9-pipeline--deals-by-stage) · [Next →](#11-company-detail--account-intelligence) · [↑ Tour](#product-tour)

---

#### 11. Company detail — account intelligence

> Leadership, strategy shifts, capex cycle, competitive moves — the account brief an exec walks into the boardroom with.

![Company detail](./repo-assets/company_detail.png)

[← Prev](#10-contact-dossier--research-grade-context) · [Next →](#12-copilot--crm--one-prompt-the-full-operating-system) · [↑ Tour](#product-tour)

---

#### 12. Copilot × CRM — one prompt, the full operating system

> "I just met Sam Altman at the GPT-5.5 event — scan everything we have on OpenAI and draft a follow-up." One turn reaches across deals, contacts, dossiers, and the inbox; the reply is links and decisions, not a chat transcript.

![Copilot — OpenAI follow-up](./repo-assets/copilot_openai.png)

[← Prev](#11-company-detail--account-intelligence) · [↑ Tour](#product-tour)

---

## The two primitives

The agent's prompt is built from two registries, sourced from
plain data — no hand-written providers per integration.

- **Skills** — markdown files (`SKILL.md`) shipped by every
  component. Loaded into the agent's prompt under `## Skills`.
  Teach the agent how to think about a domain.
- **Tools** — Zod-typed callable operations. Registered by
  Modules, dispatched at one URL: `POST /api/tools/<module>.<tool>`.
  The agent reads an inventory, calls them, gets validated
  responses with structured errors.

## The one shape

A **Module** bundles skills + tools + (optionally) schema, UI,
default workflows, default agents, routines, OAuth, and webhooks.
Three roles, same shape:

- **Connector** — brokers a 3rd-party API (`connector-google`,
  `connector-slack`)
- **Capability** — pure logic depending on other Modules
  (`triage`, `prevent-churn`)
- **Hybrid** — owns its own data + tools (`crm`, `inbox`)

All registered the same way: `app.module(myModule)`. Adding
Notion is one Module package, zero framework edits.

---

## Get started

### The one-liner

Open Cursor (or any agentic CLI — Claude Code, Codex, Gemini)
inside a clone of this repo and say:

> **"deploy boringos shell on my localhost"**

The agent will install dependencies, build the workspace, boot
embedded Postgres, and start the shell on `http://localhost:3000`.

### Manual

```bash
git clone https://github.com/BoringOS-dev/boringos.git
cd boringos
cp .env.example .env.local   # fill in any connectors you want to use
pnpm install
pnpm -r build
pnpm dev
```

Then open `http://localhost:3000`.

`.env.example` documents every env var the framework reads. Most
are optional — Google + Slack connectors no-op when their secrets
are absent, embedded Postgres boots when `DATABASE_URL` is unset.
See [`docs/setup/google.md`](docs/setup/google.md) for the
Gmail + Calendar setup walkthrough.

### Scaffold your own host

```bash
npx create-boringos my-app
cd my-app && pnpm install && pnpm dev
```

Or wire one inline:

```typescript
import { BoringOS } from "@boringos/core";
import { z } from "@boringos/module-sdk";
import type { Module } from "@boringos/module-sdk";

const helloModule: Module = {
  id: "hello",
  name: "Hello",
  version: "0.1.0",
  description: "Demo module",
  skills: [{ id: "hello", source: "module",
    body: "Use `hello.greet` to say hi to someone." }],
  tools: [{
    name: "greet",
    description: "Greet someone by name",
    inputs: z.object({ name: z.string() }),
    async handler({ name }) {
      return { ok: true, result: { message: `Hello, ${name}!` } };
    },
  }],
};

const app = new BoringOS({});
app.module(helloModule);
await app.listen(3000);
```

Embedded Postgres boots automatically, the tool dispatcher
mounts at `/api/tools/*`, and the agent's prompt now includes
the `hello` skill plus the `hello.greet` tool.

For the step-by-step guide, see
[`BUILD-A-MODULE.md`](BUILD-A-MODULE.md).

---

## Connecting Google (Gmail + Calendar)

The `@boringos/connector-google` Module needs an OAuth client.
Two minutes in Google Cloud Console, then two env vars in
`.env.local` (`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`).

See [`docs/setup/google.md`](docs/setup/google.md) for the
step-by-step Cloud Console walkthrough, the exact OAuth scopes
to request, and the production-host notes. [`.env.example`](.env.example)
lists every env var the framework reads alongside Google's.

---

## What's in the box

### Built-in Modules

| Module | Tools | Notes |
|---|---|---|
| `framework` | `tasks.{read,create,patch}`, `comments.post`, `work_products.record`, `runs.report_cost`, `agents.{create,list,wake}`, `inbox.{read,update}` | The agent's universal callback API |
| `memory` | `memory.{remember,recall,prime,forget}` | Long-term memory (Hebbs or null) |
| `drive` | `drive.{read,write,write_binary,list,delete,stat,move}` | File storage with path-prefix ACL |
| `inbox` | `inbox.{list,archive,create_task}` | Inbound message queue |
| `triage` | `triage.{next_pending,classify}` | Inbox classification capability |
| `copilot` | `copilot.start_session` | Per-tenant assistant |
| `workflow` | `workflow.{run,list,get_run}` | DAG runtime + visual editor |

### Connectors

- `@boringos/connector-google` — Gmail (send, search, read,
  archive) + Calendar
- `@boringos/connector-slack` — messages, threads, reactions

### Runtimes

Six pluggable CLI runtimes ship out of the box: Claude Code,
ChatGPT CLI, Gemini, Ollama, generic command, webhook.

### Persistence + transport

- Embedded Postgres by default; external via `DATABASE_URL`
- Drizzle ORM
- Hono HTTP server
- In-process job queue by default; BullMQ via `app.queue(...)`

---

## How an agent works

```
wake (comment / routine / event / admin)
  → coalesce + enqueue
  → fetch agent + create run row
  → build prompt: Skills (from registry) + Tools (from registry)
                  + per-run context (task, comments, session, memory)
  → spawn CLI subprocess with $BORINGOS_CALLBACK_TOKEN
  → agent calls POST /api/tools/<name> with bearer JWT
  → dispatcher: Zod-validate → handler → tool_calls audit row
  → agent posts result comment + sets status=done
  → engine auto-rewakes if more todos remain (success only)
```

Every side effect goes through one URL, validated by one schema,
audited in one table.

---

## Reference docs

- [`BUILD-A-MODULE.md`](BUILD-A-MODULE.md) — step-by-step guide to
  shipping your first Module (including dashboard widgets +
  Light/Dark theme support)
- [`MODULES.md`](MODULES.md) — Module manifest spec, including the
  [`--bos-*` theme contract](MODULES.md#theme-support---the---bos--contract)
  every UI-shipping Module should follow
- [`TOOLS.md`](TOOLS.md) — Tool spec, error model, audit, idempotency
- [`SKILLS.md`](SKILLS.md) — Skill spec, file format, priorities
- [`CLAUDE.md`](CLAUDE.md) — orientation for contributors
- [`docs/install-flow.md`](docs/install-flow.md) — how Modules are
  packaged, uploaded, installed per-tenant, and uninstalled
- [`docs/INDEX.md`](docs/INDEX.md) — full doc navigation

---

## Packages

| Package | Role |
|---|---|
| `@boringos/core` | `BoringOS` host, builder API, HTTP routes, Module registries |
| `@boringos/module-sdk` | Module / Tool / Skill type SDK (the spec) |
| `@boringos/agent` | Execution engine, context pipeline, registries + dispatcher |
| `@boringos/runtime` | 6 CLI runtimes + subprocess spawning |
| `@boringos/memory` | `MemoryProvider` interface + Hebbs adapter |
| `@boringos/drive` | `StorageBackend` + `DriveManager` |
| `@boringos/db` | Drizzle schema + embedded Postgres + migrations |
| `@boringos/workflow` | DAG runtime |
| `@boringos/workflow-ui` | React canvas + editor |
| `@boringos/pipeline` | Job queue (in-process / BullMQ) |
| `@boringos/connector-google` | Gmail + Calendar Module |
| `@boringos/connector-slack` | Slack Module |
| `@boringos/shell` | Browser shell SPA |
| `@boringos/ui` | Typed API client + React hooks |
| `create-boringos` | CLI generator |
| `@boringos/shared` | Base types, constants, utilities |

---

## Examples

- [`examples/quickstart/`](examples/quickstart/) — boot, create an
  agent, assign a task, watch it execute

---

## Commands

```bash
pnpm install
pnpm -r build
pnpm -r typecheck
pnpm test:run
```

---

## License

BoringOS uses a three-tier license layout:

- **Framework** (everything under `packages/@boringos/` except the two
  below) — **AGPL-3.0-or-later**. Strong network copyleft: anyone
  running a modified version as a service must publish their changes.
- **`@boringos/module-sdk`** — **LGPL-3.0-or-later**. Linking
  exception means modules can import the SDK under any license.
- **`@boringos/shared`** — **Apache-2.0**. Pure types/utilities,
  permissive so anything can depend on them.

Root [`LICENSE`](LICENSE) holds the AGPL text. See
[`LICENSE.md`](LICENSE.md) for the short index and
[`docs/licensing.md`](docs/licensing.md) for the longer rationale.

Contributions welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md).
