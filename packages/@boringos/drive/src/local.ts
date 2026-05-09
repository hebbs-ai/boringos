import { readFile, writeFile, unlink, stat, readdir, rename, mkdir } from "node:fs/promises";
import { join, dirname, relative, basename } from "node:path";
import { existsSync } from "node:fs";
import type { StorageBackend, FileEntry, FileStat } from "./types.js";
import { sanitizePath } from "@boringos/shared";

export function createLocalStorage(config: { root: string }): StorageBackend {
  const root = config.root;

  function resolve(path: string): string {
    return sanitizePath(root, path);
  }

  const backend: StorageBackend = {
    name: "local",

    async read(path: string): Promise<Uint8Array> {
      return readFile(resolve(path));
    },

    async readText(path: string): Promise<string> {
      return readFile(resolve(path), "utf8");
    },

    async write(path: string, content: string | Uint8Array): Promise<void> {
      const fullPath = resolve(path);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content);
    },

    async delete(path: string): Promise<void> {
      await unlink(resolve(path));
    },

    async exists(path: string): Promise<boolean> {
      return existsSync(resolve(path));
    },

    async list(prefix?: string): Promise<FileEntry[]> {
      const dir = prefix ? resolve(prefix) : root;
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        return entries.map((entry) => ({
          path: relative(root, join(dir, entry.name)),
          name: entry.name,
          isDirectory: entry.isDirectory(),
        }));
      } catch {
        return [];
      }
    },

    async move(from: string, to: string): Promise<void> {
      const toPath = resolve(to);
      await mkdir(dirname(toPath), { recursive: true });
      await rename(resolve(from), toPath);
    },

    async stat(path: string): Promise<FileStat | null> {
      try {
        const s = await stat(resolve(path));
        return {
          path,
          size: s.size,
          modifiedAt: s.mtime,
        };
      } catch {
        return null;
      }
    },

    skillMarkdown() {
      return DRIVE_SKILL;
    },
  };

  return backend;
}

export async function scaffoldDrive(root: string, tenantId: string): Promise<void> {
  const tenantRoot = join(root, tenantId);
  const dirs = ["projects", "agents", "tasks", "shared", "inbox"];

  for (const dir of dirs) {
    await mkdir(join(tenantRoot, dir), { recursive: true });
  }

  const skillPath = join(tenantRoot, ".drive-skill.md");
  if (!existsSync(skillPath)) {
    await writeFile(skillPath, DRIVE_SKILL, "utf8");
  }
}

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

## Delivering an artifact to the user

When the user asks for something visual or downloadable (image,
chart, PDF, CSV, transcript, audio clip):

1. Generate the bytes locally (matplotlib, ffmpeg, pandoc,
   imagemagick — whatever produces the file).
2. Persist via drive:
   - text → \`drive.write({ path, content })\`
   - binary → \`drive.write_binary({ path, contentBase64 })\`
3. **Read the response, find \`result.url\`, copy that exact
   string into your comment.** The shape is always
   \`{"ok": true, "result": {"path": "...", "bytes": N, "url": "/api/admin/drive/file/..."}}\`.
   The URL **always** starts with \`/api/admin/drive/file/\` —
   any other host (\`storage.boringos.dev\`, \`cdn.*\`, S3
   links) is a fabrication.
4. Post the comment via \`framework.comments.post({ taskId, body })\`:
   - images: \`![<alt>](<url>)\` — renders inline.
   - everything else: \`[<filename>](<url>)\` — renders as a link.

If you call drive tools from a Bash sub-shell, you must **print the
full response body** before extracting \`result.url\` — the JSON
is invisible to you otherwise. \`print(json.dumps(body))\` first,
then read \`body["result"]["url"]\`.

### Do
- Use descriptive filenames: \`q2-completion-rate.png\`,
  not \`chart.png\`.
- One artifact = one drive file = one URL. Don't paste base64 into
  the comment body.
- Mention what the artifact is in the comment text, not just the
  embed.

### Don't
- **Don't fabricate URLs.** The only valid prefix is
  \`/api/admin/drive/file/\`. If you didn't see the URL printed
  back from a tool response in this run, you don't know it.
- Don't claim you produced an artifact you didn't actually write
  to drive — verify the upload returned \`{"ok": true}\` first.
- Don't write giant binaries (>25 MB) — chunk or compress first.
- Don't write to \`users/<id>/\` paths — those are private to a
  human user; you'll get a 403.
`;
