// SPDX-License-Identifier: BUSL-1.1
//
// Drive — browse tenant artifacts. Two-pane layout: left is a
// breadcrumb + folder/file list at the current prefix; right is
// the type-switched FilePreview.
//
// Listing uses the existing GET /api/admin/drive/list, which
// returns rows from the driveFiles index. Folders are computed
// client-side by grouping path prefixes.

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthProvider.js";
import { ScreenBody, ScreenHeader, EmptyState, LoadingState } from "../_shared.js";
import { FilePreview, type DriveFileRow } from "./FilePreview.js";

interface ListResponse {
  files: DriveFileRow[];
}

function useDriveFiles(): { files: DriveFileRow[]; loading: boolean; error: string | null; reload: () => void } {
  const { token } = useAuth();
  const [files, setFiles] = useState<DriveFileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    fetch("/api/admin/drive/list", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as ListResponse;
      })
      .then((b) => { if (!cancelled) { setFiles(b.files); setError(null); } })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token, tick]);

  return { files, loading, error, reload: () => setTick((t) => t + 1) };
}

interface DirEntry {
  kind: "folder" | "file";
  /** Path under the current prefix — folder name or filename. */
  name: string;
  /** Full path (only set for files). */
  fullPath?: string;
  /** Index of the file row in the parent's `files` array (only set
   * for files). */
  fileRow?: DriveFileRow;
  /** Aggregate file count under this folder (only set for folders). */
  childCount?: number;
}

/** Group all files into the entries visible at a given prefix. */
function entriesAtPrefix(files: DriveFileRow[], prefix: string): DirEntry[] {
  const trimmedPrefix = prefix.replace(/^\/+|\/+$/g, "");
  const filtered = trimmedPrefix
    ? files.filter((f) => f.path.startsWith(`${trimmedPrefix}/`))
    : files;

  const folderCounts = new Map<string, number>();
  const childFiles: DirEntry[] = [];

  for (const f of filtered) {
    const rest = trimmedPrefix
      ? f.path.slice(trimmedPrefix.length + 1)
      : f.path;
    const slashIdx = rest.indexOf("/");
    if (slashIdx < 0) {
      // Direct child file at this prefix.
      childFiles.push({ kind: "file", name: rest, fullPath: f.path, fileRow: f });
    } else {
      const folder = rest.slice(0, slashIdx);
      folderCounts.set(folder, (folderCounts.get(folder) ?? 0) + 1);
    }
  }

  const folders: DirEntry[] = Array.from(folderCounts.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ kind: "folder" as const, name, childCount: count }));

  childFiles.sort((a, b) => a.name.localeCompare(b.name));

  return [...folders, ...childFiles];
}

function Breadcrumb({
  prefix,
  onNavigate,
}: {
  prefix: string;
  onNavigate: (p: string) => void;
}) {
  const parts = prefix.split("/").filter(Boolean);
  return (
    <div className="text-xs text-muted flex flex-wrap items-center gap-1 px-3 py-2 border-b border-border-subtle">
      <button
        type="button"
        onClick={() => onNavigate("")}
        className="hover:text-text hover:underline"
      >
        drive
      </button>
      {parts.map((p, i) => {
        const target = parts.slice(0, i + 1).join("/");
        return (
          <span key={target} className="flex items-center gap-1">
            <span className="text-muted">/</span>
            <button
              type="button"
              onClick={() => onNavigate(target)}
              className="hover:text-text hover:underline font-mono"
            >
              {p}
            </button>
          </span>
        );
      })}
    </div>
  );
}

function FolderRow({
  name,
  count,
  onOpen,
}: {
  name: string;
  count: number;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-bg border-b border-border-subtle"
    >
      <span className="text-muted w-4 text-center">▸</span>
      <span className="flex-1 text-text font-mono truncate">{name}/</span>
      <span className="text-xs text-muted">{count}</span>
    </button>
  );
}

function FileRow({
  file,
  active,
  onSelect,
}: {
  file: DriveFileRow;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm border-b border-border-subtle transition-colors ${
        active ? "bg-accent-tint text-accent" : "hover:bg-bg"
      }`}
    >
      <span className="text-muted w-4 text-center">·</span>
      <span className="flex-1 truncate font-mono">{file.filename}</span>
      <span className="text-xs text-muted shrink-0">
        {formatSize(file.size)}
      </span>
    </button>
  );
}

function formatSize(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}K`;
  return `${(n / 1024 / 1024).toFixed(1)}M`;
}

export function Drive() {
  const { files, loading, error, reload } = useDriveFiles();
  const [prefix, setPrefix] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const entries = useMemo(() => entriesAtPrefix(files, prefix), [files, prefix]);
  const selectedFile = useMemo(
    () => files.find((f) => f.path === selectedPath) ?? null,
    [files, selectedPath],
  );

  return (
    <>
      <ScreenHeader
        title="Drive"
        subtitle="Browse files agents have produced and uploads."
        actions={
          <button
            type="button"
            onClick={reload}
            className="text-xs text-muted hover:text-text px-2 py-1 rounded hover:bg-bg-warm"
            title="Reload"
          >
            ↻ Reload
          </button>
        }
      />
      <ScreenBody>
        <div className="flex h-[75vh] border border-border rounded overflow-hidden bg-white">
          {/* Left: folder/file tree */}
          <div className="w-[340px] border-r border-border flex flex-col">
            <Breadcrumb prefix={prefix} onNavigate={setPrefix} />
            <div className="flex-1 overflow-auto">
              {loading && <LoadingState />}
              {error && (
                <div className="p-3 text-sm text-red-600">Failed: {error}</div>
              )}
              {!loading && !error && entries.length === 0 && (
                <EmptyState
                  title="No files here"
                  description={
                    prefix
                      ? "This folder is empty. Use the breadcrumb to go back."
                      : "Drive is empty. Files agents create with drive.write or drive.write_binary will appear here."
                  }
                />
              )}
              {!loading && !error && entries.map((e) =>
                e.kind === "folder" ? (
                  <FolderRow
                    key={`folder:${e.name}`}
                    name={e.name}
                    count={e.childCount ?? 0}
                    onOpen={() =>
                      setPrefix(prefix ? `${prefix}/${e.name}` : e.name)
                    }
                  />
                ) : (
                  <FileRow
                    key={`file:${e.fullPath}`}
                    file={e.fileRow!}
                    active={selectedPath === e.fullPath}
                    onSelect={() => setSelectedPath(e.fullPath ?? null)}
                  />
                ),
              )}
            </div>
          </div>

          {/* Right: preview */}
          <div className="flex-1 flex flex-col min-w-0">
            <FilePreview file={selectedFile} />
          </div>
        </div>
      </ScreenBody>
    </>
  );
}
