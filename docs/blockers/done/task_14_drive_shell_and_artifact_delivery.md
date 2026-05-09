# Blocker — task_14: Drive in shell + agent artifact delivery

> **Why now:** users ask agents to "make me an image / chart / PDF /
> CSV" and the agent has no way to deliver. It can write text to
> drive, but binary writes are blocked by the v2 tool schema, no HTTP
> route serves drive content, and comments are text-only. So the
> agent either fakes it ("I made the image") or drops the request
> silently. Closing this loop is the cheapest unlock for a large
> class of useful tasks.

> **Direction:** drive is a typed, ACL'd **publishing surface** —
> not the agent's open laptop. The agent already has a real shell in
> its CLI runtime workdir; that's where work happens. Drive is where
> the agent **publishes** the result so a user (or the next agent,
> or the browser) can see it. We're adding three things: a way to
> write binary, a way to fetch what was written over HTTP, and a
> place in the shell to browse it. Plus a path-prefix ACL so
> per-user privacy works without a schema change.

> **Depends on:** none. v2 only — built on existing v2 module surface.

---

## 1. The two surfaces

This is the mental model the rest of the doc rests on.

| | Agent's local workdir (CLI runtime) | Drive (this task) |
|---|---|---|
| Shape | Open laptop — full bash, FS, network. `--dangerously-skip-permissions`. | Curated tools (read / write / list / ...). Server-executed. ACL-gated. |
| Lifetime | Ephemeral — per-run subprocess workdir | Persistent — tenant-scoped object store + `driveFiles` index |
| Scope | One agent, this run only | Multi-user, multi-agent, multi-run |
| Used for | *Doing* the work — run python/matplotlib, ffmpeg, pdftotext, install deps | *Publishing* the result so someone else can see it |

When an agent generates a chart it uses its **local laptop** to actually run matplotlib (the binaries — matplotlib, ffmpeg, imagemagick — live in the agent's CLI runtime, not the framework). It then **publishes** the resulting PNG into drive via `drive.write_binary` — that's where ACL fires and a URL becomes available.

Trove conflates these two surfaces (and so has to ship Landlock+seccomp around exec). BoringOS keeps them separate, so drive needs no kernel sandbox — its multi-tenant safety is just path-prefix ACL.

This means the framework does **not** need to ship an image-generation module to make image delivery work. Any artifact the agent's local shell can produce — chart from matplotlib, PDF from pandoc, thumbnail from ffmpeg, transcript from whisper — gets published the same way.

---

## 2. The problem, end to end

Four working steps are needed. Three are broken.

| Step | Status | Where |
|---|---|---|
| 1. Generate the artifact | **Works** | Agent's CLI runtime has python, ffmpeg, imagemagick, pandoc — whatever the runtime ships with |
| 2. Persist it to drive | **Half-broken** | `DriveManager.write` accepts `Uint8Array` (`drive/src/manager.ts:13`), but the v2 `drive.write` tool restricts `content` to `z.string()` (`core/src/v2-modules/drive.ts:70`) — no binary path |
| 3. Get a URL the user can load | **Missing** | Only routes are `GET /drive/list`, `GET /drive/skill`, `PATCH /drive/skill` (`core/src/admin-routes.ts:1797–1825`) — no file-serve route |
| 4. Embed in a comment | **Works** *(once a URL exists)* | `Markdown.tsx:20` allow-lists `img`; `ALLOWED_ATTR` includes `src` |

A separate `taskAttachments` table is declared (`db/src/schema/task-features.ts:20`) and imported once in `admin-routes.ts:24` but **never read or written** — dead schema. Don't revive it; the drive-as-storage path is simpler and more general.

Drive **already has a skill**, two of them in fact:

- `DRIVE_SKILL` in `drive/src/local.ts:94` — folder-organization conventions, written to disk as `.drive-skill.md` per tenant.
- `DRIVE_SKILL` in `core/src/v2-modules/drive.ts:18` — v2 module skill, lists the tool surface.

Neither teaches the laptop-vs-drive distinction, the path conventions, or how to deliver an artifact in a comment. That's the third missing piece.

Drive also has **no shell screen** (`packages/@boringos/shell/src/screens/` has Tasks, Workflows, Inbox, etc., but no Drive). Users can't browse what agents have produced.

---

## 3. Per-tenant, per-user — by path prefix, not by schema

Drive today is keyed by `(tenantId, path)` only — no `userId`. So drive is **shared across all users in a tenant**. That's the right default for most artifacts (an agent-produced report belongs to the team) but wrong for personal files (a user's uploaded contract).

Solve it by partitioning paths, not by adding columns.

```
<tenantId>/                    ← storage prefix (server-added, never in URLs)
├── shared/...                 ← any tenant member can read+write
├── projects/<projectId>/...   ← scoped by project membership (existing)
├── tasks/<taskId>/...         ← anyone who can see the task (= tenant for now)
├── users/<userId>/...         ← only that user (+ admins)
└── agents/<agentId>/...       ← agent's working dir (tenant-readable)
```

A single `canAccess(reqUserId, reqRole, path)` function — ~30 lines — enforces this at two sites: the file-serve route (Phase 1) and the v2 drive tools (Phase 2). The tool's `ToolContext` already carries `tenantId` and `taskId`; we add `userId` for runs where the agent is acting in a copilot-style user-scoped context.

**Default path resolution.** When the agent calls `drive.write({ path, ... })`:

- Path starts with a recognized prefix → honor as-is, ACL applies.
- Path is relative AND the run has a `taskId` → rewrite to `tasks/<taskId>/<path>`.
- Path is relative and no `taskId` → rewrite to `agents/<agentId>/<path>`.

The agent rarely thinks about prefixes — it writes filenames, the framework places them correctly.

**No schema changes.** No `userId` column on `driveFiles`. No per-file ACL table. If sharing-with-specific-users-inside-the-tenant ever becomes a real requirement, we add it then.

---

## 4. Goals

1. **Agents can deliver images, charts, PDFs, CSVs in comments.** The agent's local shell produces the bytes; drive persists them; the comment embeds the URL; the markdown renderer shows it inline.
2. **Drive is browsable in the shell.** A new screen lists tenant files with a tree by prefix; clicking a file opens it (preview for images / text / pdf, download for everything else).
3. **One delivery pattern for every artifact type.** Whether the artifact came from matplotlib, pandoc, ffmpeg, or an external API — same recipe: `drive.write_binary` → URL → `comments.post`.
4. **Per-user privacy works.** A file under `users/<X>/` is readable only by user X (and tenant admins). Enforced at the route + tool layer via path prefix.
5. **No new schema.** Reuse `driveFiles`. Don't add `taskAttachments`. Don't change `taskComments`. Don't add `userId` to drive.

### Non-goals (explicit)

- **Shipping an image-generation module as part of this task.** The agent's local shell already produces plenty of artifact types. An `image` module is one optional follow-up — not on the critical path.
- **Snapshots / point-in-time recovery.** A great primitive (Trove proves it). Separate follow-up task.
- **Signed / time-limited URLs.** Useful when the agent wants to put a URL in an outbound email. Out of scope here.
- **Real-time streaming generation.** Out of scope; deliver as completed artifact.
- **Sandboxed exec inside drive (Trove-style).** Premature for us — agent CLI's local shell already fills this role.
- **Multipart user-upload endpoint** (drag-drop a file onto a comment from the UI). Out of scope; the `taskAttachments` schema stays dormant.

---

## 5. Plan

Four phases. Each phase is independently shippable and useful.

### Phase 1 — Drive serves files over HTTP

**Goal:** any tenant-authenticated request can fetch a drive file by path and get the bytes back with the right `Content-Type`, **ACL-checked**.

- New route in `core/src/admin-routes.ts`:
  ```
  GET /api/admin/drive/file/*  →  streams StorageBackend.read(tenantPath)
  ```
  Wildcard captures the rest of the path. Resolve `(userId, tenantId, role)` from the auth context (already available via `createAuthMiddleware`).
- **Path validation:** reject `..`, absolute paths, AND **percent-encoded variants** (`%2e%2e`, `%2f`). Decode-then-check, not check-then-decode.
- **ACL:** call `canAccess(userId, role, path)` after path resolution; 403 on cross-user / cross-task paths.
- Content-Type: derive from extension via a small map (`png`, `jpg`, `webp`, `gif`, `svg`, `pdf`, `csv`, `json`, `txt`, `md`, `html`); default `application/octet-stream`. `Content-Disposition: inline` for embeddable types, `attachment` otherwise.
- Auth: dual-mode `createAuthMiddleware(db)` (sessions + API key). Agents reading their own writes use the existing `drive.read` tool; this route is for the **browser** rendering inline images / previews.
- Cache: `Cache-Control: private, max-age=60` and an ETag of `driveFiles.hash` so re-renders don't re-stream.

**Cross-origin note (dev):** shell runs on Vite at `:5174`, core on `:3000`. Add a `/api` proxy entry to the shell's `vite.config.ts` (cleanest, matches how shell already calls the rest of the API). Verify if it exists; add if not.

### Phase 2 — `drive.write` accepts binary + ACL on tool calls

**Goal:** the agent can persist a PNG / PDF / anything via the v2 tool surface, and tool calls respect the same ACL as the route.

- Add a sibling tool **`drive.write_binary`** with `inputs: z.object({ path: z.string(), contentBase64: z.string() })`. Decode → `Uint8Array` → `r.drive.write(...)`. Keep `drive.write` text-only and unchanged. Recommended over a union type — explicit, easy to grep, no schema churn.
- **Default path rewriting** (per §3). Agent passes a relative filename; framework places it under `tasks/<ctx.taskId>/...` or `agents/<ctx.agentId>/...`.
- **ACL:** call `canAccess` on `drive.read`, `drive.write`, and `drive.write_binary`. Same function as Phase 1.
- Both write tools return:
  ```ts
  { ok: true, result: { path, bytes, url: `/api/admin/drive/file/${path}` } }
  ```
  This is what the agent quotes back into a comment.
- **Size cap:** ~25MB on `contentBase64` (config-tunable). Prevents runaway tool-call payloads.

### Phase 3 — Drive skill teaches the laptop-vs-drive split + delivery protocol

**Goal:** the agent knows the *recipe*, not just the function names.

Replace the v2 module skill in `core/src/v2-modules/drive.ts` with one that teaches the mental model first, then the recipe:

```markdown
## Drive — your tenant's persistent storage

Your local shell is your scratchpad — install deps, run scripts,
generate bytes. **Drive is where you publish anything someone else
needs to see** (the user, the next agent, the task UI). Path
conventions and ACLs apply only to drive; your local workdir is
yours alone and disappears when the run ends.

### Path conventions

- `tasks/<task-id>/...` — deliverables for this task
  (default for relative paths during a task run)
- `shared/...` — tenant-wide artifacts
- `projects/<id>/...` — project-scoped
- `users/<id>/...` — private to one user
- `agents/<id>/...` — your own working directory

### Delivering an artifact to a user

1. Generate the bytes locally (matplotlib, ffmpeg, pandoc, etc.).
2. Write to drive:
   - text → `drive.write({ path, content })`
   - binary → `drive.write_binary({ path, contentBase64 })`
   The response includes a `url` field — that's the public URL.
3. Post a comment that embeds the URL:
   - images: `![<alt>](<url>)` — renders inline.
   - everything else: `[<filename>](<url>)` — renders as a link.
   Use `framework.comments.post({ taskId, body })`.

### Do
- Use descriptive filenames. `q2-completion-rate.png`, not `chart.png`.
- One artifact = one drive file = one URL. Don't paste base64 into
  the comment body.
- Mention what the artifact is in the comment text, not just the embed.

### Don't
- Don't fabricate URLs you didn't get from a tool response.
- Don't claim you produced an artifact you didn't actually write
  to drive.
- Don't write giant binaries (>25MB) — chunk or compress first.
```

Same recipe + path conventions go into the v1 `local.ts` `DRIVE_SKILL`.

### Phase 4 — Drive in the shell: how users actually see files

**Goal:** users have an obvious place to browse artifacts, and inline embedding works for the common case.

Three ways a user encounters drive content. **All three already work in principle once Phases 1–2 ship** — Phase 4 just builds the dedicated screen.

1. **Inline in a task comment.** When the agent embeds `![](/api/admin/drive/file/...)` or `[Q2 report](...)`, the existing `Markdown` renderer (`shell/src/components/Markdown.tsx`) loads the URL and displays it. Free — no UI change. **This is the primary channel** for artifacts the agent produces in response to a request.
2. **Drive screen (this phase).** New screen `packages/@boringos/shell/src/screens/Drive/`:
   - `index.tsx` — left pane: prefix tree from `GET /api/admin/drive/list`. Bias the listing toward "what the agent did" — recent-first, group by `tasks/<id>/` and `users/<self>/`, attribute files to the writing agent. Right pane: file viewer.
   - `FilePreview.tsx` — type-switched: images via `<img src={url} />`, text/markdown via the existing `Markdown` component, PDFs via `<iframe>`, everything else: filename + size + download button.
   - Add to `screens/index.ts` and the shell nav.
   - Respect ACL: `users/<X>/` is hidden from anyone not user X (or admin).
3. **"Recent artifacts" widget on the Tasks screen** (optional polish): list files under `tasks/<current-task-id>/`. One quick query, one small card list. Lets the user spot artifacts the agent produced even if they weren't embedded in a comment.

API surface needed:
- `GET /api/admin/drive/list?prefix=` — already exists at `admin-routes.ts:1797`. Confirm it returns enough metadata (filename, size, mimeType, updatedAt, author if available); extend if not.
- `DELETE /api/admin/drive/file/*` — new, optional this phase.
- The serve route from Phase 1 covers reads + previews.

---

## 6. The full agent flow, end to end

```
User: "Make me a bar chart of task completion this week."

Agent (in its local CLI shell):
  $ python3 - <<'PY'
    import matplotlib.pyplot as plt
    # ... query data, plot ...
    plt.savefig('/tmp/chart.png')
    PY
  $ base64 /tmp/chart.png > /tmp/chart.b64

Agent (via tools):
  1. drive.write_binary({
       path: "chart-2026-05-09.png",      // relative — framework places under tasks/<id>/
       contentBase64: <contents of /tmp/chart.b64>
     })
     → { path: "tasks/<id>/chart-2026-05-09.png",
         url:  "/api/admin/drive/file/tasks/<id>/chart-2026-05-09.png",
         bytes: 47213 }

  2. comments.post({
       taskId: "<id>",
       body:   "Here's the completion chart for this week:\n\n
                ![completion chart](/api/admin/drive/file/tasks/<id>/chart-2026-05-09.png)\n\n
                Tuesday and Thursday were the strongest days."
     })

User opens the task → markdown renderer fetches the URL → image renders inline.
User can also open the Drive screen → tasks/<id>/ → see the same file with metadata.
```

For non-image artifacts the only change is the embed: `[Q2 report.pdf](url)` instead of `![](url)`. Same write path, same routes, same skill section.

---

## 7. Acceptance criteria

A teammate cold-reading this task is done when:

1. `curl -H 'X-API-Key: ...' /api/admin/drive/file/tasks/foo/bar.png` returns the bytes with `Content-Type: image/png`. A request from user A for `users/<B>/...` returns 403.
2. From an agent run, `drive.write_binary({ path, contentBase64 })` writes the file under the auto-resolved task path and returns `{ url }`. `drive.write` text path still works unchanged.
3. An agent-produced comment with `![](/api/admin/drive/file/...)` renders inline in the existing TaskCommentsThread without any UI change.
4. The shell has a Drive screen accessible from the nav. It lists files, previews images / markdown / PDF, navigates by prefix, and hides `users/<X>/` from anyone but X (or admin).
5. The drive skill (both v1 `local.ts` and v2 `drive.ts`) explicitly documents (a) the laptop-vs-drive split, (b) path conventions, (c) the artifact-delivery recipe.
6. Path validation rejects `..`, absolute paths, and percent-encoded equivalents on every drive surface (route + tools).
7. No changes to `taskComments`, `taskAttachments`, or any task schema. No new database tables. No `userId` column on `driveFiles`.

---

## 8. Open questions

- **`canAccess` for `tasks/<taskId>/...`.** Today: same tenant = full access. If task ACL ever tightens (per-team, per-collaborator), `canAccess` integrates with the existing task-visibility query — that's the place to plug it.
- **Path validation library vs hand-rolled.** Hand-rolled is fine for ~5 rules; pull in a library only if the rule set grows.
- **Surfacing author on listed files.** `driveFiles` doesn't currently store who wrote a file. Adding `authorAgentId` / `authorUserId` columns is the cheapest way to make Phase 4's "what did agent X produce?" view real. Decide before Phase 4 — one-line schema addition that pays off immediately.
- **Cleanup / retention.** Drive will accumulate generated artifacts forever. Separate task: a sweeper for `tasks/*/...` files older than N days, or per-tenant TTL config. Not blocking.

---

## 9. Follow-up tasks (intentionally out of scope here)

- **Drive snapshots.** Auto-daily + manual snapshots, restore-as-of, retention. Trove's pattern is the right shape; we have hashes already in `driveFiles`.
- **Signed time-limited URLs.** For agents to embed drive URLs in outbound emails / Slack messages.
- **Outbound webhooks on drive events.** `file.written`, `file.deleted` with HMAC signing — for downstream apps that want to react.
- **Optional `image` module.** Single provider, only registered when an API key is present. Not blocking — agent shells can produce images via local libraries.
- **BoringOS as MCP server.** Expose the v2 tool catalog (drive included) as an MCP server so external clients (Claude Desktop, Cursor) can use a tenant's drive too.

---

## 10. Why this is the right shape

- **Two surfaces, two jobs.** Drive is a typed, ACL'd publishing layer; the agent's CLI is the actual laptop. Keeping these separate means drive needs no kernel sandbox and the laptop needs no multi-tenant ACL — each surface only handles what it's good at.
- **Reuses what exists.** Drive is already storage; the agent already has a shell; markdown renderer already supports `<img>`; comments already auto-render markdown. The smallest set of additions makes the loop work.
- **One delivery primitive.** Every artifact is a drive file plus a URL. No special-case attachments table, no comment-attachment join, no UI fork between "regular comments" and "comments with files."
- **Privacy by convention.** `users/<id>/`, `tasks/<id>/`, `shared/` mean the path itself tells you who can see the file. No new tables, no per-file ACL entries, easy to grep, easy to audit.
- **Composable.** Any future producer (chart, PDF, screenshot, audio clip, transcript) gets the same delivery path for free.
- **Honest agent UX.** Agents stop fabricating "I made the image"; either the bytes hit drive and a URL appears, or the agent says it can't.
