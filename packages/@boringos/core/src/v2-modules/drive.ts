// SPDX-License-Identifier: MIT
//
// `drive` Module — wraps the configured StorageBackend as a v2
// Module exposing the file ops as tools.
//
// Phase 5 of task_12.

import { z } from "@boringos/module-sdk";
import type {
  Module,
  ModuleFactory,
  Tool,
  ToolContext,
  ToolResult,
} from "@boringos/module-sdk";
import type { StorageBackend } from "@boringos/drive";

const DRIVE_SKILL = `Use the drive tools to read and write files in the
tenant's persistent file storage.

- \`drive.read(path)\` — read text content
- \`drive.write(path, content)\` — write text content
- \`drive.list(prefix?)\` — list files, optionally filtered by prefix
- \`drive.delete(path)\` — remove a file
- \`drive.exists(path)\` — boolean check
- \`drive.move(from, to)\` — atomic rename / move

Paths are tenant-scoped — you cannot escape the tenant's drive. Conventions:
keep generated artifacts under \`/artifacts/<task-id>/\`; user-uploaded files
under \`/uploads/\`. The drive does not version files automatically — if you
need history, use a versioned filename pattern (e.g. \`-v2.md\`).`;

export const createDriveModule: ModuleFactory = (deps) => {
  const drive = deps.drive as StorageBackend | undefined;

  const requireDrive = (): { error: ToolResult } | { drive: StorageBackend } => {
    if (!drive) {
      return {
        error: {
          ok: false,
          error: { code: "upstream_unavailable", message: "Drive backend not configured", retryable: false },
        },
      };
    }
    return { drive };
  };

  const readTool: Tool = {
    name: "read",
    description: "Read a file as text",
    inputs: z.object({ path: z.string() }),
    async handler(input: { path: string }): Promise<ToolResult> {
      const r = requireDrive();
      if ("error" in r) return r.error;
      try {
        const text = await r.drive.readText(input.path);
        return { ok: true, result: { path: input.path, content: text } };
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
    description: "Write text content to a file",
    inputs: z.object({ path: z.string(), content: z.string() }),
    async handler(input: { path: string; content: string }): Promise<ToolResult> {
      const r = requireDrive();
      if ("error" in r) return r.error;
      await r.drive.write(input.path, input.content);
      return { ok: true, result: { path: input.path, bytes: input.content.length } };
    },
  };

  const listTool: Tool = {
    name: "list",
    description: "List files (optionally filtered by prefix)",
    inputs: z.object({ prefix: z.string().optional() }),
    async handler(input: { prefix?: string }): Promise<ToolResult> {
      const r = requireDrive();
      if ("error" in r) return r.error;
      const files = await r.drive.list(input.prefix);
      return { ok: true, result: { files } };
    },
  };

  const deleteTool: Tool = {
    name: "delete",
    description: "Delete a file",
    inputs: z.object({ path: z.string() }),
    async handler(input: { path: string }): Promise<ToolResult> {
      const r = requireDrive();
      if ("error" in r) return r.error;
      await r.drive.delete(input.path);
      return { ok: true, result: { ok: true } };
    },
  };

  const existsTool: Tool = {
    name: "exists",
    description: "Check if a file exists",
    inputs: z.object({ path: z.string() }),
    async handler(input: { path: string }): Promise<ToolResult> {
      const r = requireDrive();
      if ("error" in r) return r.error;
      const exists = await r.drive.exists(input.path);
      return { ok: true, result: { exists } };
    },
  };

  const moveTool: Tool = {
    name: "move",
    description: "Move or rename a file",
    inputs: z.object({ from: z.string(), to: z.string() }),
    async handler(input: { from: string; to: string }): Promise<ToolResult> {
      const r = requireDrive();
      if ("error" in r) return r.error;
      await r.drive.move(input.from, input.to);
      return { ok: true, result: { ok: true } };
    },
  };

  const module: Module = {
    id: "drive",
    name: "Drive",
    version: "0.1.0",
    description: "Tenant-scoped file storage",
    provides: ["file-storage"],
    skills: [
      {
        id: "drive",
        source: "module",
        body: DRIVE_SKILL,
        priority: 65,
      },
    ],
    tools: [readTool, writeTool, listTool, deleteTool, existsTool, moveTool],
  };

  return module;
};
