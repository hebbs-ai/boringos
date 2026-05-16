# Hebbs — the thesis, in one read

> The single source of truth for what Hebbs is, what ships, and how
> we sell. **When writing any new doc, README section, deck slide,
> or marketing copy — align with this file.** If a doc disagrees
> with this thesis, the doc is wrong (or this file is out of date —
> update it deliberately).

---

## The bet

Every company is about to need an operating system for its agents.
Not a chatbot. Not a workflow tool. A real OS — with a shell you
log into, a cabinet of agents that report to a chief of staff, and
modules you install to give the company new surfaces (sales,
finance, research, support).

We ship the OS. Anyone — us, a partner, or a customer's own team —
ships modules on top.

## What ships on day zero — the **Shell**

The Shell is the portal. Open a fresh Hebbs tenant and you already
get:

- **Home / executive brief** — open work, agents online, weekly
  spend, watch items.
- **Tasks** — the operating unit of work. Every task has an owner,
  blockers, decisions, risks, comments.
- **Copilot** — ask anything, get decision-ready output (briefs,
  drafts, charts), not a chat transcript.
- **Agents** — the cabinet. Chief of Staff at the top, named pods
  underneath (GTM, RevOps, Eng, …).
- **Workflows** — drag-and-drop, event- and time-triggered, with a
  trace on every step.
- **Budgets** — tenant cap, per-team caps, spend by agent and by
  model.

This is "day zero." No module installed. The company can already be
run from this screen.

## What you install on top — **Modules**

A Module is a single `.hebbsmod` file (a signed zip, like `.vsix`
or `.apk`). One click in the Shell's **Apps** screen installs it
into the tenant. Examples:

- **CRM** — pipeline, deals, contacts, companies, research-grade
  dossiers.
- **VCBrain** — deal flow, founder dossiers, portfolio tracking.
- **Books** — finance, invoices, P&L.
- **Support, HR, Recruiting, …** — whatever surface a company
  needs.

Each module brings its own **skills** (what the agent knows how to
do), **tools** (what it can call), optional **schema** (its own
tables), and optional **UI** (new pages in the nav). The Shell
hot-loads it. Uninstall is one click.

## How the framework works — the boring picture

Three primitives, that's it:

1. **Skills** — markdown the agent reads as instructions.
2. **Tools** — typed functions the agent can call (with audit +
   idempotency).
3. **Modules** — bundles of skills + tools + optional schema + UI.

A Module registers once via `app.module(myModule)`; the framework
wires the rest — routing, install lifecycle, per-tenant data
isolation, OAuth, webhooks, routines.

Under the hood, **the agent is a CLI** — Claude Code, Codex,
Gemini, Ollama. Hebbs doesn't call LLM APIs. It spawns the CLI as a
subprocess, hands it the relevant skills, exposes the tools,
captures the output. That's the wedge: orchestration, memory, UX,
and the Shell — not another LLM router.

Result: every model vendor's improvement lands in Hebbs the day
their CLI ships it.

> The open-source framework is named **BoringOS**; the product and
> brand is **Hebbs**. Docs inside this repo can use the framework
> name where it adds clarity; product-facing copy is always Hebbs.

## How we sell

- **Wedge in with the Shell.** Most prospects see the Shell and
  immediately get it — "this is how I want to run my company."
  That's the demo and the first deal.
- **Land the first module.** Almost every customer needs a
  CRM-shaped or research-shaped surface. We ship CRM and VCBrain
  ourselves so the first install is one-click.
- **Open the marketplace.** Other teams (and customers' own
  engineers) build modules. We curate, sign, distribute. Same model
  as VSCode extensions / WordPress plugins / Shopify apps — every
  successful OS has this loop.
- **Pricing.** Per-tenant seat for the Shell. Module revenue share
  for marketplace. Enterprise: spend-cap-aware, so finance signs
  off without surprise.

## The one-line version

> **Hebbs is the OS for agents.** Shell on day zero. Install
> modules — CRM, VCBrain, Books, anything — like apps. The agents
> are CLIs; the framework is the glue.

---

## For doc writers (humans + AI)

Before writing or editing any doc in this repo:

1. Re-read this thesis.
2. Make sure the doc you're writing supports one of: **Shell**,
   **Modules**, **framework primitives** (Skills / Tools /
   Modules), or **how we sell**.
3. Don't invent new top-level concepts. If you need one, propose
   it here first and update this file.
4. Don't say "BoringOS" in product/UI/marketing copy. Inside this
   repo's framework docs, the name is fine.
