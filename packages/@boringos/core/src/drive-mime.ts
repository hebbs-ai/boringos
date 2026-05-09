// SPDX-License-Identifier: MIT
//
// Tiny extension → Content-Type lookup for the drive file-serve
// route. Kept narrow on purpose — only the formats agents actually
// produce or that browsers render inline. Anything missing falls
// through to `application/octet-stream`, which the browser treats
// as a download.

const TYPES: Record<string, string> = {
  // Images — embedded inline in comments via <img>.
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",

  // Documents users open inline.
  pdf: "application/pdf",

  // Text formats — rendered in the Drive screen previewer or
  // markdown-rendered inline.
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
  yaml: "application/yaml; charset=utf-8",
  yml: "application/yaml; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  html: "text/html; charset=utf-8",
  log: "text/plain; charset=utf-8",

  // Audio/video — agents may transcribe or trim media.
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  webm: "video/webm",

  // Archives — download.
  zip: "application/zip",
  tar: "application/x-tar",
  gz: "application/gzip",
};

const INLINE_TYPES = new Set([
  "image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml",
  "image/avif", "image/bmp", "image/x-icon",
  "application/pdf",
  "text/plain; charset=utf-8", "text/markdown; charset=utf-8",
  "text/csv; charset=utf-8", "application/json; charset=utf-8",
  "application/yaml; charset=utf-8", "application/xml; charset=utf-8",
  "text/html; charset=utf-8",
  "audio/mpeg", "audio/wav", "audio/ogg",
  "video/mp4", "video/webm",
]);

export function contentTypeFor(path: string): string {
  const i = path.lastIndexOf(".");
  if (i < 0) return "application/octet-stream";
  const ext = path.slice(i + 1).toLowerCase();
  return TYPES[ext] ?? "application/octet-stream";
}

export function shouldRenderInline(contentType: string): boolean {
  return INLINE_TYPES.has(contentType);
}
