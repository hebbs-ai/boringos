# Blocker — task_18: Shell theme, look-and-feel, and standard UX adoption

> **Why now:** the marketing site (`hebbs-website`) and the product
> shell look like two different products. The website has a worked-out
> brand idiom — warm beige, amber accents, Space Grotesk wordmark,
> Inter + JetBrains Mono, Tailwind v4 `@theme` tokens, dark "band"
> overrides, gradient orbs. The shell is plain Tailwind v3-style with
> hardcoded slate everywhere and a generic blue accent. The handoff
> from website → product is jarring.
>
> Two adjacent things are also overdue:
> - The shell hand-rolls every modal, dropdown, tooltip, popover —
>   inconsistent and a11y-shaky.
> - The `BrandProvider` exists (`primaryColor`, `productName`,
>   `logoUrl`) but **almost no screen reads from it**, so tenant
>   rebranding doesn't actually repaint the chrome.
>
> Closing all three in one pass — token system, component library,
> tenant theming bridge — costs roughly 5 days end-to-end and gives
> the shell a real visual identity.

> **Depends on:** none. Pure shell + ui-package work. The token
> renames touch ~90 files but each is a mechanical replacement.

> **Decisions locked** (2026-05-09):
> - **Aesthetic**: same family as the website, denser surfaces.
>   Amber accent + warm-tinted neutrals, but cooler/denser surfaces
>   tuned for productivity (Linear-like density, Hebbs-tinted).
> - **Components**: shadcn/ui + Radix + Lucide.
> - **Motion**: restrained — Framer Motion on rails + modals only,
>   no background animation in work screens.
> - **Wordmark**: Space Grotesk on logo + sidebar product name; Inter
>   everywhere else.

---

## 0. What's already there

- Marketing site idiom: `hebbs-website/src/styles/global.css` — Tailwind
  v4 `@theme` block with semantic tokens, drifting orb backgrounds,
  neural mesh canvas, dark band overrides, Inter + JetBrains Mono +
  Space Grotesk fonts.
- Shell brand contract: `packages/@boringos/shell/src/branding/types.ts`
  defines `Brand` with `primaryColor`, `secondaryColor`, `productName`,
  `logoUrl`, etc. Defaults in `branding/defaults.ts` (currently blue-600
  + slate-900).
- `BrandProvider` (`branding/BrandProvider.tsx`) loads `brand.*` keys
  from `tenant_settings` and exposes `useBrand()`. Sidebar reads
  `brand.logoUrl` and `brand.productName` but no other surface does.
- shadcn ecosystem deps already partially present: `cmdk` is in
  `packages/@boringos/shell/package.json`. Tiptap, dompurify, @xyflow,
  @tanstack/react-query, react-router-dom — typical Tailwind app stack.
- Existing CSS entrypoint: `packages/@boringos/shell/src/index.css` is
  literally `@import "tailwindcss";` and nothing else.

---

## 1. The mismatch, named

| | hebbs-website | boringos shell |
|---|---|---|
| Tailwind | v4 with `@theme` tokens | v3-style, no tokens |
| Background | warm beige `#F0EDE8` | white + slate-50 |
| Accent | amber `#B45309` / `#D97706` | blue-600 (default brand) |
| Borders | `#D5CFC5` warm | slate-200 cool |
| Text | stone-900 `#1C1917` | slate-900 |
| Wordmark font | Space Grotesk | none — Inter for everything |
| Mono usage | JetBrains Mono on stats/IDs | rare |
| Component primitives | hand-rolled HTML | hand-rolled HTML |
| Motion | gradient orbs, neural mesh, drift | CSS transitions, ad-hoc |
| BrandProvider read | n/a | sidebar only |

The shell isn't ugly — it's *anonymous*. There's no single visual
detail that says "this is Hebbs."

---

## 2. The plan

### 2a. Token system (Tailwind v4 `@theme`)

Replace `shell/src/index.css` with a tokens block modeled on the
website but **shell-tuned**: warmer neutrals than vanilla slate, but
cooler than the website's beige (so the shell reads as work, not
prose).

```css
@import "tailwindcss";

@theme {
  /* Surfaces — warm-tinted neutrals, denser than the website */
  --color-bg:                #FAF9F7;  /* one notch warmer than slate-50 */
  --color-bg-warm:           #F5F3EE;  /* matches website's secondary surface */
  --color-surface:           #FFFFFF;  /* card / panel base */
  --color-surface-raised:    #FFFFFF;  /* modal, popover */
  --color-surface-tint:      rgba(180,83,9,0.04);  /* 4% accent tint for subtle backdrops */
  --color-border:            #E2DED5;
  --color-border-subtle:     #ECE9E2;

  /* Text */
  --color-text:              #1C1917;  /* stone-900, matches website */
  --color-text-secondary:    #44403C;  /* stone-700 */
  --color-muted:             #78716C;  /* stone-500 */
  --color-muted-strong:      #57534E;  /* stone-600 */

  /* Accent — defaults to Hebbs amber; tenant brand overrides */
  --color-accent:            #B45309;  /* amber-700 */
  --color-accent-light:      #D97706;
  --color-accent-bright:     #F59E0B;  /* used in dark surfaces */

  /* Taxonomy */
  --color-cyan:              #0E7490;
  --color-green:             #047857;
  --color-red:               #B91C1C;
  --color-navy:              #1E293B;

  /* Semantic */
  --color-success:           var(--color-green);
  --color-warning:           var(--color-accent-light);
  --color-danger:            var(--color-red);
  --color-info:              var(--color-cyan);

  /* Typography */
  --font-sans:  "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-mono:  "JetBrains Mono", ui-monospace, "Cascadia Code", monospace;
  --font-logo:  "Space Grotesk", "Inter", ui-sans-serif, system-ui, sans-serif;
}
```

This intentionally diverges from the website on `--color-bg`: a
denser app surface uses lighter, warmer-but-not-beige neutrals so
content stands out. The website is content-on-paper; the shell is
information-density.

### 2b. Brand → token bridge

`BrandProvider` already loads `brand.*` keys. Extend it to write
matching CSS custom properties at `:root` whenever brand resolves:

```ts
useEffect(() => {
  const root = document.documentElement;
  if (brand.primaryColor) root.style.setProperty("--color-accent", brand.primaryColor);
  if (brand.secondaryColor) root.style.setProperty("--color-navy", brand.secondaryColor);
  // Optionally derive --color-accent-light, --color-surface-tint from primary
}, [brand]);
```

One brand setting → whole shell repaints. Tenants get real branding.

### 2c. Codemod hardcoded slate/blue → semantic tokens

The shell has ~90 files referencing `bg-slate-*`, `text-slate-*`,
`bg-blue-*`. The migration is a finite set of substitutions:

| Old | New |
|---|---|
| `bg-slate-50` | `bg-bg` |
| `bg-slate-100` | `bg-bg-warm` |
| `bg-white` | `bg-surface` |
| `text-slate-900` | `text-text` |
| `text-slate-700` | `text-text-secondary` |
| `text-slate-500` | `text-muted` |
| `text-slate-400` | `text-muted` (or muted/70) |
| `border-slate-100` | `border-border-subtle` |
| `border-slate-200` | `border-border` |
| `bg-blue-600` | `bg-accent` |
| `text-blue-600` | `text-accent` |
| `border-blue-400` | `border-accent` |

A scripted `sed` over `packages/@boringos/shell/src` does 90% of it.
Per-file polish for the rest. **Each screen migrates independently**;
there's no point at which the shell is broken.

### 2d. Typography + density

- **Body**: Inter at 13/14px (vs website's 16). Productivity apps want
  density; this is Linear's choice.
- **Wordmark**: Space Grotesk on the sidebar product name + login
  screen logo only. Inter elsewhere — Space Grotesk competing with
  content text would feel editorial in the wrong way.
- **Mono**: JetBrains Mono for IDs, timestamps, model names, key
  paths, route paths. Tabular nums on every number column.
- **Scale**: 11/12/13/14/16/20/24/30. Cap headings at 24/30. The
  website's 56–80px heroes belong on landing pages, not in chrome.
- **Line height**: 1.4 body, 1.2 headings.

Add fonts via `@import` in `index.css`:

```css
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&family=Space+Grotesk:wght@600;700&display=swap");
```

### 2e. Component library — shadcn/ui + Radix + Lucide

The shell hand-rolls every modal, dialog, dropdown, switch, popover,
tooltip, tabs strip. They look fine, but each has slightly different
spacing/animation/a11y. shadcn's value: copy-paste components owned in
the shell repo, built on Radix primitives, styled with our tokens.

**Adoption order** (each ships independently):

1. **Dialog** — replaces `<NewAgentModal>`, `<InviteModal>`,
   `<ReparentConfirm>`, `<ScheduleMeetingModal>`.
2. **Dropdown / ContextMenu** — replaces hand-rolled menus in
   Inbox `ActionToolbar`, Tasks `TaskActionToolbar`.
3. **Tabs** — replaces ad-hoc tab strips in Apps, Settings, Agents
   right-rail, Inbox.
4. **Switch / Checkbox / RadioGroup** — replaces hand-rolled toggles
   in `Settings/AgentsPanel.tsx` (global pause), `<SettingInput>`'s
   BooleanInput, manifest section.
5. **Tooltip / HoverCard** — currently zero in the shell;
   Sparkline + status pills + role icons all want one.

**Lucide icons** replace text glyphs (`☰ ☶ ⚙ ⌂ ✦ ♚ ⚐`). The
hand-picked role glyphs we shipped in task_15 §5 stay as a fallback
for unknown roles, but built-in roles map to Lucide icons (`Crown`
for CEO, `Compass` for Triage, `Mail` for Replier, `Wrench` for
Engineer, etc.).

### 2f. Motion budget — Framer Motion only where it earns

Keep the shell calm. Use Framer Motion in three places:

1. **Right-rail slide-in** (`AgentDetailPanel`) — `motion.aside` with
   `initial={{ x: '100%' }} animate={{ x: 0 }}`. 200ms ease-out.
2. **Modals** — fade backdrop, scale-in dialog. 150ms.
3. **Toast stack** — Sonner handles this for free.

**Do not** animate the work surfaces (cards, lists, tables). Linear
proves productivity tools feel faster with no surface motion.

### 2g. Toasts — Sonner

Replace `window.confirm`, inline `setError(string)` divs, and the
hand-rolled "Saved!" copy banner in HierarchyTab. Sonner gives:

- Stacking with collision avoidance
- Auto-dismiss with hover-pause
- Action buttons (`undo`, `view`)
- Dark/light mode parity

Wire once at `App.tsx` (`<Toaster />` in `<Layout />`); call
`toast.success("Maya invited")`, `toast.error("...")` from screens.

### 2h. Command palette — `cmdk`

Already a dep, never wired. Bind `⌘K` globally; targets:

- Jump to: agent / task / inbox / settings / activity / team
- Action: wake agent, pause agent, run routine, install app,
  invite team member
- Recent: last 5 opened agents/tasks
- Fuzzy match across names + ids

The Tasks screen's `useTasks` and Agents' `useAgents` already paginate
locally — palette pulls from those caches. Backend touch zero.

### 2i. Background motifs — keep restrained

- **Keep**: a *very faint* dot-grid (`rgba(120,113,108,0.04)`, 24px
  spacing) on `body`. Subtle texture, common in productivity tools
  (Linear, Notion). Cuts the "blank canvas" feel.
- **Drop in chrome**: orbs, neural mesh, drifting gradients, scroll
  bands. They burn GPU and hurt focus. Marketing-only.
- **Keep on login + onboarding wizard**: the orbs and gradient hero.
  These are the handoff moments where operators see the brand.

### 2j. Login + onboarding rebuild

The strongest place to put the website's idiom inside the shell:

- **Login screen**: dark surface (`#050510`), drifting orbs from the
  website's CSS, gradient text headline ("Welcome to *brand
  name*"), Space Grotesk hero. Right-side panel for the auth form on
  warm-beige `--color-bg-warm`. This is the single screen where the
  shell looks 80% like the website.
- **Signup screen**: same idiom.
- **Onboarding wizard**: 2–3 step tour after first login (connect
  email, install first app, meet your cabinet). Lift the website's
  section-divider gradient and dark band styling; reuse warm
  surfaces between steps.

After that, the shell looks like a tool — the brand is in the
wordmark, accent color, and density, not the chrome.

### 2k. Tenant theming — what one slider should change

Brand panel's primary color picker should repaint:

- All `bg-accent`, `text-accent`, `border-accent` tokens — by far the
  most impactful.
- Login screen orbs (currently amber) — derive from accent.
- Status pills' "running" emerald stays semantic; doesn't follow
  brand.
- Sidebar active-nav highlight.

Tenants picking a green primary should see a coherent green-themed
shell, not a weird mix.

---

## 3. Phased execution

| Phase | What | Effort | Outcome |
|---|---|---|---|
| 1 | Tokens + Tailwind v4 `@theme` block + brand→CSS-var bridge | 1d | Shell uses semantic tokens; brand color repaints |
| 2 | Codemod slate/blue → tokens (top 10 patterns) | 0.5d | Top-50 files migrated |
| 3 | Typography + Space Grotesk wordmark in sidebar + login | 0.25d | Hebbs DNA visible in chrome |
| 4 | shadcn install + migrate Dialog/Dropdown/Tabs/Switch | 1d | 5 hand-rolled patterns gone |
| 5 | Lucide icons replacing text glyphs | 0.5d | Sidebar + role icons + status icons consistent |
| 6 | Framer Motion on right-rail + modals + Sonner toasts | 0.5d | Buttery interactions; no more `window.confirm` |
| 7 | `⌘K` palette via `cmdk` | 0.5d | Power-user navigation |
| 8 | Login + Onboarding rebuild with website idiom | 1d | Handoff feels coherent |
| 9 | Per-tenant theming polish + Brand panel preview | 0.25d | Repaint picker works end-to-end |

**Total: ~5.5 days.** Phases 1–4 fix 80% of the "looks like a different
product" complaint; ship them first.

---

## 4. What this doc deliberately doesn't decide

- **Dark mode**: the website has dark bands, the shell has none.
  Skip until phases 1–4 land — adding dark mode is cheaper once
  semantic tokens exist (define dark `:root` overrides).
- **Custom favicon per tenant**: BrandProvider has `faviconUrl`
  already; wire it after tokens land.
- **Density toggle** (compact vs comfortable spacing): worth
  considering after baseline density is set; defer.
- **Mobile/responsive pass**: shell is desktop-first; don't pretend
  otherwise mid-theme work.
- **Animation library choice**: Framer Motion is the call. If we
  ever ship to React 19's compiler-strict mode and motion churns,
  swap to `motion.dev` (the new fork) as a drop-in.

---

## 5. References & decisions baked in

- **Aesthetic family**: Linear's density, Hebbs's amber-on-warm
  paint job. Not Notion (too friendly), not Stripe Dashboard (too
  corporate), not Slack (too saturated).
- **Component library**: shadcn/ui — copy-paste, owned in our repo,
  Radix primitives underneath. Industry default for Tailwind apps in
  2025/2026; replacing it later is also easy because we own the
  source.
- **Icons**: Lucide — 24×24 grid, 1.5px stroke weight, fits Hebbs's
  serious-tool tone better than Heroicons or Tabler.
- **Motion**: Framer Motion. Confirmed: restrained — rails + modals
  only.
- **Toasts**: Sonner — bestest in class, tiny.
- **Command palette**: `cmdk` — already a dep, just unused.

---

## 6. Pointers to consult while executing

- Website tokens (the source of truth):
  `/Users/paragarora/Documents/Workspace/research/hebbs-repos/hebbs-website/src/styles/global.css`
- Shell's current empty CSS entrypoint:
  `packages/@boringos/shell/src/index.css`
- Shell brand contract:
  `packages/@boringos/shell/src/branding/{types,defaults,BrandProvider}.ts`
- Existing chrome to update first:
  `packages/@boringos/shell/src/chrome/{Sidebar,Layout,CommandBar,ConnectorsHealthIndicator}.tsx`
- Hand-rolled patterns to replace with shadcn primitives:
  - `screens/Agents/{NewAgentModal,AgentDetailPanel}.tsx` — Dialog + Drawer
  - `screens/Team/InviteModal.tsx` — Dialog
  - `screens/Agents/tabs/HierarchyTab.tsx` (ReparentConfirm) — AlertDialog
  - `screens/Inbox/ScheduleMeetingModal.tsx` — Dialog
  - `screens/Apps/index.tsx` and `screens/Agents/index.tsx` — Tabs
  - `screens/Settings/AgentsPanel.tsx` global pause toggle — Switch
  - All hand-rolled `<select>` usages — shadcn Select
- Existing `cmdk` dep:
  `packages/@boringos/shell/package.json` (already declared, never imported)
- v1→v2 north star (Module shape that brand/theme integrates with):
  `task_12_greenfield_rebuild.md`
- Settings manifest (where `brand.*` keys live):
  `task_17_tenant_settings_manifest.md`
