// SPDX-License-Identifier: BUSL-1.1
//
// FilePreview — type-switched viewer for the right pane of the
// Drive screen. Image / markdown / text / pdf inline; everything
// else falls back to a download button.

import { useEffect, useState } from "react";
import { Markdown } from "../../components/Markdown.js";
import { useAuth } from "../../auth/AuthProvider.js";
import { driveUrl } from "./url.js";

export interface DriveFileRow {
  path: string;
  filename: string;
  format: string | null;
  size: number;
  hash: string | null;
  updatedAt?: string;
  createdAt?: string;
}

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg", "avif", "bmp"]);
const TEXT_EXTS = new Set(["txt", "md", "csv", "json", "yaml", "yml", "xml", "log", "html"]);
const PDF_EXTS = new Set(["pdf"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg"]);
const VIDEO_EXTS = new Set(["mp4", "webm"]);

function extOf(path: string): string {
  const i = path.lastIndexOf(".");
  return i < 0 ? "" : path.slice(i + 1).toLowerCase();
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function FileMetadata({ file }: { file: DriveFileRow }) {
  return (
    <div className="text-xs text-muted mt-2 flex flex-wrap gap-x-4 gap-y-1">
      <span className="font-mono break-all">{file.path}</span>
      <span>{formatBytes(file.size)}</span>
      {file.format && <span className="uppercase">{file.format}</span>}
      {file.updatedAt && <span>updated {new Date(file.updatedAt).toLocaleString()}</span>}
    </div>
  );
}

function TextPreview({ url }: { url: string }) {
  const { token } = useAuth();
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError(null);
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((t) => { if (!cancelled) setText(t); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [url, token]);

  if (error) return <div className="text-sm text-red-600 mt-3">Failed to load: {error}</div>;
  if (text === null) return <div className="text-sm text-muted mt-3">Loading…</div>;
  return (
    <pre className="mt-3 p-3 bg-bg border border-border rounded text-xs font-mono whitespace-pre-wrap overflow-auto max-h-[70vh]">
      {text}
    </pre>
  );
}

function MarkdownPreview({ url }: { url: string }) {
  const { token } = useAuth();
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.text())
      .then((t) => { if (!cancelled) setText(t); })
      .catch(() => { if (!cancelled) setText("# Failed to load"); });
    return () => { cancelled = true; };
  }, [url, token]);

  if (text === null) return <div className="text-sm text-muted mt-3">Loading…</div>;
  return (
    <div className="mt-3 p-4 bg-white border border-border rounded">
      <Markdown source={text} />
    </div>
  );
}

export function FilePreview({ file }: { file: DriveFileRow | null }) {
  if (!file) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted">
        Select a file to preview
      </div>
    );
  }

  const ext = extOf(file.path);
  const url = driveUrl(file.path);

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-base font-semibold text-text break-all">{file.filename}</h2>
        <a
          href={url}
          download={file.filename}
          className="text-xs text-accent hover:underline whitespace-nowrap"
        >
          Download
        </a>
      </div>
      <FileMetadata file={file} />

      {IMAGE_EXTS.has(ext) && (
        <img
          src={url}
          alt={file.filename}
          className="mt-4 max-w-full rounded border border-border bg-checkerboard"
          style={{ maxHeight: "70vh" }}
        />
      )}
      {ext === "md" && <MarkdownPreview url={url} />}
      {TEXT_EXTS.has(ext) && ext !== "md" && <TextPreview url={url} />}
      {PDF_EXTS.has(ext) && (
        <iframe
          src={url}
          title={file.filename}
          className="mt-4 w-full border border-border rounded"
          style={{ height: "70vh" }}
        />
      )}
      {AUDIO_EXTS.has(ext) && (
        <audio src={url} controls className="mt-4 w-full" />
      )}
      {VIDEO_EXTS.has(ext) && (
        <video src={url} controls className="mt-4 max-w-full rounded border border-border" />
      )}
      {!IMAGE_EXTS.has(ext) &&
        !TEXT_EXTS.has(ext) &&
        !PDF_EXTS.has(ext) &&
        !AUDIO_EXTS.has(ext) &&
        !VIDEO_EXTS.has(ext) && (
          <div className="mt-6 text-sm text-muted">
            No inline preview for this format. Use the download link above.
          </div>
        )}
    </div>
  );
}
