// SPDX-License-Identifier: MIT
//
// `drive` Module — wraps the configured StorageBackend as a v2
// Module exposing the file ops as tools.
//
// Phase 5 of task_12. Phase 2 of task_14 added binary writes,
// path-prefix ACL, default-path resolution, and a public URL in
// the write response so agents can embed artifacts in comments.

import { z } from "@boringos/module-sdk";
import type {
  Module,
  ModuleFactory,
  Tool,
  ToolContext,
  ToolResult,
} from "@boringos/module-sdk";
import type { Db } from "@boringos/db";
import type { StorageBackend } from "@boringos/drive";
import { eq, and } from "drizzle-orm";
import { createHash } from "node:crypto";
import { driveFiles } from "@boringos/db";
import { generateId } from "@boringos/shared";
import {
  canAccess,
  resolveAgentPath,
  validatePath,
  type Actor,
} from "./drive-acl.js";

// 25 MB cap on a single binary write — keeps tool-call payloads
// bounded. Bumped from 10 MB in the hand-rolled write-text limit
// because base64 is ~33% larger than the underlying bytes and we
// want the agent to be able to deliver e.g. a 15 MB PDF.
const MAX_BINARY_BYTES = 25 * 1024 * 1024;

const DRIVE_SKILL = `# Drive — your tenant's persistent storage

Your local shell is your scratchpad — install deps, run scripts,
generate bytes, scratch files. **Drive is where you publish
anything someone else needs to see** (the user, the next agent,
the task UI). Path conventions and ACLs apply only to drive; your
local workdir is yours alone and disappears when the run ends.

## Path conventions

- \`tasks/<task-id>/...\` — deliverables for this task
  (the default for relative filenames during a task run)
- \`shared/...\` — tenant-wide artifacts
- \`projects/<id>/...\` — project-scoped
- \`users/<id>/...\` — private to one user (you cannot read or write
  these as an agent)
- \`agents/<id>/...\` — your own working directory

When you call \`drive.write\` / \`drive.write_binary\` with a bare
filename (no prefix) the framework auto-places it under
\`tasks/<your task id>/\` if you're working on a task, otherwise
under \`agents/<your id>/\`. Use an explicit prefix when you want
something different.

## Tools

- \`drive.read(path)\` — read a UTF-8 text file
- \`drive.write(path, content)\` — write a UTF-8 text file. Returns
  \`{ path, bytes, url }\`.
- \`drive.write_binary(path, contentBase64)\` — write binary content
  (max 25 MB after decoding). Returns \`{ path, bytes, url }\`.
- \`drive.list(prefix?)\` — list files, optionally filtered by prefix
- \`drive.delete(path)\` — remove a file
- \`drive.exists(path)\` — boolean check
- \`drive.move(from, to)\` — rename / move a file

## Delivering an artifact to the user

When the user asks for something visual or downloadable (image,
chart, PDF, CSV, transcript, audio clip):

1. Generate the bytes locally (matplotlib, ffmpeg, pandoc,
   imagemagick — whatever produces the file). **Do not** invent
   bytes you didn't actually compute.
2. Persist via drive:
   - text → \`drive.write({ path, content })\`
   - binary → \`drive.write_binary({ path, contentBase64 })\`
3. **Read the response, find \`result.url\`, copy that exact string
   into your comment.** This is non-negotiable. The response shape
   is always:
   \`\`\`json
   {"ok": true, "result": {"path": "...", "bytes": 1234, "url": "/api/admin/drive/file/..."}}
   \`\`\`
   The URL **always** starts with \`/api/admin/drive/file/\`. There
   is no other valid form. Anything else (e.g.
   \`https://storage.<anything>\`, \`https://cdn...\`, an S3 link, a
   public host) is a fabrication — the URL must come *from the
   tool response you just received*, not from your training data
   or your imagination.
4. Post the comment with \`framework.comments.post({ taskId, body })\`:
   - images: \`![<alt>](<url>)\` — renders inline.
   - everything else: \`[<filename>](<url>)\` — renders as a link.

## Calling drive tools from a Bash sub-shell

If you POST via curl/python/urllib instead of using a typed tool
call, the response body is invisible to you unless you print it.
**Always print the full response body**, then pull the URL out of
it before you write the comment. In python:

\`\`\`python
import os, json, urllib.request, base64
url = os.environ["BORINGOS_CALLBACK_URL"]
tok = os.environ["BORINGOS_CALLBACK_TOKEN"]
req = urllib.request.Request(
    f"{url}/api/tools/drive.write_binary",
    data=json.dumps({
        "path": "tasks/<task-id>/chart.png",
        "contentBase64": base64.b64encode(open("/tmp/chart.png","rb").read()).decode(),
    }).encode(),
    headers={"Authorization": f"Bearer {tok}",
             "Content-Type": "application/json"},
)
body = json.loads(urllib.request.urlopen(req).read())
print(json.dumps(body))                        # THIS PRINT IS REQUIRED
chart_url = body["result"]["url"]              # embed this exact string
\`\`\`

If you do not print the body, you will not know the URL, and any
URL you guess will be wrong.

### Do
- Use descriptive filenames. \`q2-completion-rate.png\`,
  not \`chart.png\`.
- One artifact = one drive file = one URL. Don't paste base64 into
  the comment body.
- Mention what the artifact is in the comment text, not just the
  embed.

### Don't
- **Don't fabricate URLs.** The only valid prefix is
  \`/api/admin/drive/file/\`. Hosts like \`storage.boringos.dev\`,
  \`cdn.*\`, S3 buckets, presigned links — none of these exist
  in this framework. If you didn't see the URL printed back from
  a tool response in this run, you don't know it.
- Don't claim you produced an artifact you didn't actually write
  to drive — verify the upload returned \`{"ok": true}\` first.
- Don't write giant binaries (>25 MB) — chunk or compress first.
- Don't write to \`users/<id>/\` paths — those are private to a
  human user; you'll get a 403.`;

interface DriveModuleDeps {
  drive: StorageBackend;
  db: Db;
}

/** Build the actor for ACL checks from the tool context. */
function actorFromCtx(ctx: ToolContext): Actor {
  if (ctx.invokedBy === "agent" || ctx.invokedBy === "routine" || ctx.invokedBy === "workflow") {
    return { kind: "agent", agentId: ctx.agentId, taskId: ctx.taskId };
  }
  // Admin/internal callers act with system privileges. No userId
  // is plumbed through ToolContext yet, so treat them as admin
  // for ACL purposes.
  return { kind: "user", userId: "system", role: "admin" };
}

/** Build the public URL the agent embeds in a comment. The URL
 * is relative so it works with whatever scheme/host serves the
 * shell. */
function publicUrl(path: string): string {
  return `/api/admin/drive/file/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** Persist + index a file. Mirrors what DriveManager.write does
 * but inline so we don't need to construct a manager per call. */
async function indexedWrite(
  deps: DriveModuleDeps,
  tenantId: string,
  path: string,
  content: string | Uint8Array,
): Promise<{ bytes: number; hash: string }> {
  const tenantPath = `${tenantId}/${path}`;
  await deps.drive.write(tenantPath, content);

  const bytes = typeof content === "string" ? Buffer.byteLength(content) : content.byteLength;
  const buf = typeof content === "string" ? Buffer.from(content) : Buffer.from(content);
  const hash = createHash("sha256").update(buf).digest("hex").slice(0, 16);

  const ext = path.includes(".") ? path.slice(path.lastIndexOf(".") + 1) : null;
  const filename = path.split("/").pop() ?? path;

  const existing = await deps.db
    .select()
    .from(driveFiles)
    .where(and(eq(driveFiles.tenantId, tenantId), eq(driveFiles.path, path)))
    .limit(1);
  if (existing[0]) {
    await deps.db.update(driveFiles).set({
      size: bytes,
      hash,
      format: ext,
      updatedAt: new Date(),
    }).where(eq(driveFiles.id, existing[0].id));
  } else {
    await deps.db.insert(driveFiles).values({
      id: generateId(),
      tenantId,
      path,
      filename,
      format: ext,
      size: bytes,
      hash,
    });
  }

  return { bytes, hash };
}

export const createDriveModule: ModuleFactory = (factoryDeps) => {
  const drive = factoryDeps.drive as StorageBackend | undefined;
  const db = factoryDeps.db as Db | undefined;

  function requireDeps(): { error: ToolResult } | { deps: DriveModuleDeps } {
    if (!drive) {
      return {
        error: {
          ok: false,
          error: { code: "upstream_unavailable", message: "Drive backend not configured", retryable: false },
        },
      };
    }
    if (!db) {
      return {
        error: {
          ok: false,
          error: { code: "upstream_unavailable", message: "Database not configured", retryable: false },
        },
      };
    }
    return { deps: { drive, db } };
  }

  /** Resolve + ACL-check a user-supplied path for a given op. */
  function resolveAndAuthorize(
    rawPath: string,
    ctx: ToolContext,
    op: "read" | "write",
  ): { ok: true; path: string } | { ok: false; error: ToolResult } {
    const r = resolveAgentPath(rawPath, { taskId: ctx.taskId, agentId: ctx.agentId });
    if (!r.ok) {
      return {
        ok: false,
        error: {
          ok: false,
          error: { code: "invalid_input", message: r.reason, retryable: false },
        },
      };
    }
    const decision = canAccess(actorFromCtx(ctx), op, r.path);
    if (!decision.ok) {
      return {
        ok: false,
        error: {
          ok: false,
          error: { code: "permission_denied", message: decision.reason, retryable: false },
        },
      };
    }
    return { ok: true, path: r.path };
  }

  const readTool: Tool = {
    name: "read",
    description: "Read a file as text",
    inputs: z.object({ path: z.string() }),
    async handler(input: { path: string }, ctx: ToolContext): Promise<ToolResult> {
      const d = requireDeps();
      if ("error" in d) return d.error;
      const auth = resolveAndAuthorize(input.path, ctx, "read");
      if (!auth.ok) return auth.error;
      try {
        const text = await d.deps.drive.readText(`${ctx.tenantId}/${auth.path}`);
        return { ok: true, result: { path: auth.path, content: text } };
      } catch (e) {
        return {
          ok: false,
          error: { code: "not_found", message: e instanceof Error ? e.message : "read failed", retryable: false },
        };
      }
    },
  };

  const writeTool: Tool = {
    name: "write",
    description: "Write text content to a file. Relative paths are auto-placed under tasks/<taskId>/ or agents/<agentId>/.",
    inputs: z.object({ path: z.string(), content: z.string() }),
    async handler(input: { path: string; content: string }, ctx: ToolContext): Promise<ToolResult> {
      const d = requireDeps();
      if ("error" in d) return d.error;
      const auth = resolveAndAuthorize(input.path, ctx, "write");
      if (!auth.ok) return auth.error;
      const r = await indexedWrite(d.deps, ctx.tenantId, auth.path, input.content);
      return {
        ok: true,
        result: { path: auth.path, bytes: r.bytes, url: publicUrl(auth.path) },
      };
    },
  };

  const writeBinaryTool: Tool = {
    name: "write_binary",
    description:
      "Write binary content (up to 25 MB after base64 decoding) to a file. Use this for images, PDFs, audio, and any other non-text artifact you want a user to see. Relative paths are auto-placed under tasks/<taskId>/.",
    inputs: z.object({
      path: z.string(),
      /** Base64-encoded bytes. Standard base64; agents typically
       * produce this from the host shell with `base64 < file`. */
      contentBase64: z.string(),
    }),
    async handler(
      input: { path: string; contentBase64: string },
      ctx: ToolContext,
    ): Promise<ToolResult> {
      const d = requireDeps();
      if ("error" in d) return d.error;
      const auth = resolveAndAuthorize(input.path, ctx, "write");
      if (!auth.ok) return auth.error;

      // Decode base64 (allowing whitespace from line-wrapped input).
      const cleaned = input.contentBase64.replace(/\s/g, "");
      // Reject obviously-not-base64 input early. Buffer.from with
      // base64 encoding silently truncates on bad chars; we want
      // a clear error instead.
      if (!/^[A-Za-z0-9+/=]*$/.test(cleaned)) {
        return {
          ok: false,
          error: { code: "invalid_input", message: "contentBase64 must be standard base64", retryable: false },
        };
      }
      let bytes: Buffer;
      try {
        bytes = Buffer.from(cleaned, "base64");
      } catch {
        return {
          ok: false,
          error: { code: "invalid_input", message: "failed to decode base64 content", retryable: false },
        };
      }
      if (bytes.byteLength > MAX_BINARY_BYTES) {
        return {
          ok: false,
          error: {
            code: "invalid_input",
            message: `file exceeds the ${MAX_BINARY_BYTES} byte limit (got ${bytes.byteLength})`,
            retryable: false,
          },
        };
      }

      const r = await indexedWrite(d.deps, ctx.tenantId, auth.path, new Uint8Array(bytes));
      return {
        ok: true,
        result: { path: auth.path, bytes: r.bytes, url: publicUrl(auth.path) },
      };
    },
  };

  const listTool: Tool = {
    name: "list",
    description: "List files (optionally filtered by prefix)",
    inputs: z.object({ prefix: z.string().optional() }),
    async handler(input: { prefix?: string }, ctx: ToolContext): Promise<ToolResult> {
      const d = requireDeps();
      if ("error" in d) return d.error;
      // Validate prefix if provided — agents shouldn't be able to
      // list things like `..` or absolute paths.
      let prefixForStorage: string | undefined;
      if (input.prefix) {
        const v = validatePath(input.prefix);
        if (!v.ok) {
          return { ok: false, error: { code: "invalid_input", message: v.reason, retryable: false } };
        }
        prefixForStorage = `${ctx.tenantId}/${v.path}`;
      } else {
        prefixForStorage = ctx.tenantId;
      }
      const files = await d.deps.drive.list(prefixForStorage);
      // Strip the tenant prefix from returned paths so agents see
      // tenant-relative paths.
      const tenantPrefix = `${ctx.tenantId}/`;
      const stripped = files.map((f) => ({
        ...f,
        path: f.path.startsWith(tenantPrefix) ? f.path.slice(tenantPrefix.length) : f.path,
      }));
      return { ok: true, result: { files: stripped } };
    },
  };

  const deleteTool: Tool = {
    name: "delete",
    description: "Delete a file",
    inputs: z.object({ path: z.string() }),
    async handler(input: { path: string }, ctx: ToolContext): Promise<ToolResult> {
      const d = requireDeps();
      if ("error" in d) return d.error;
      const auth = resolveAndAuthorize(input.path, ctx, "write");
      if (!auth.ok) return auth.error;
      try {
        await d.deps.drive.delete(`${ctx.tenantId}/${auth.path}`);
      } catch (e) {
        return {
          ok: false,
          error: { code: "not_found", message: e instanceof Error ? e.message : "delete failed", retryable: false },
        };
      }
      // Drop the index row too.
      await d.deps.db
        .delete(driveFiles)
        .where(and(eq(driveFiles.tenantId, ctx.tenantId), eq(driveFiles.path, auth.path)));
      return { ok: true, result: { ok: true } };
    },
  };

  const existsTool: Tool = {
    name: "exists",
    description: "Check if a file exists",
    inputs: z.object({ path: z.string() }),
    async handler(input: { path: string }, ctx: ToolContext): Promise<ToolResult> {
      const d = requireDeps();
      if ("error" in d) return d.error;
      const auth = resolveAndAuthorize(input.path, ctx, "read");
      if (!auth.ok) return auth.error;
      const exists = await d.deps.drive.exists(`${ctx.tenantId}/${auth.path}`);
      return { ok: true, result: { exists } };
    },
  };

  const moveTool: Tool = {
    name: "move",
    description: "Move or rename a file",
    inputs: z.object({ from: z.string(), to: z.string() }),
    async handler(input: { from: string; to: string }, ctx: ToolContext): Promise<ToolResult> {
      const d = requireDeps();
      if ("error" in d) return d.error;
      const fromAuth = resolveAndAuthorize(input.from, ctx, "write");
      if (!fromAuth.ok) return fromAuth.error;
      const toAuth = resolveAndAuthorize(input.to, ctx, "write");
      if (!toAuth.ok) return toAuth.error;
      await d.deps.drive.move(
        `${ctx.tenantId}/${fromAuth.path}`,
        `${ctx.tenantId}/${toAuth.path}`,
      );
      // Best-effort index update — rename the row.
      await d.deps.db
        .update(driveFiles)
        .set({ path: toAuth.path, filename: toAuth.path.split("/").pop() ?? toAuth.path, updatedAt: new Date() })
        .where(and(eq(driveFiles.tenantId, ctx.tenantId), eq(driveFiles.path, fromAuth.path)));
      return { ok: true, result: { ok: true } };
    },
  };

  const module: Module = {
    id: "drive",
    name: "Drive",
    version: "0.2.0",
    description: "Tenant-scoped file storage with public URLs for agent-published artifacts",
    provides: ["file-storage"],
    skills: [
      {
        id: "drive",
        source: "module",
        body: DRIVE_SKILL,
        priority: 65,
      },
    ],
    tools: [readTool, writeTool, writeBinaryTool, listTool, deleteTool, existsTool, moveTool],
  };

  return module;
};
