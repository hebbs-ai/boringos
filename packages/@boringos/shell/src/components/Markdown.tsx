// SPDX-License-Identifier: BUSL-1.1
//
// Safe Markdown renderer.
//
// AI agents speak Markdown — task descriptions, agent comments, draft
// reply bodies, copilot replies all arrive as md. Rendering them as
// plain text loses the structure (lists, headings, code blocks,
// links) that the agent went to the trouble of producing.
//
// Pipeline: marked (md → html) → DOMPurify (allow-list sanitize) →
// dangerouslySetInnerHTML on a div with prose-like Tailwind classes.
// The allow-list mirrors the inbox EmailBody one but adds the small
// set of structural tags markdown produces (h1-h6, ul, ol, li, hr,
// pre, code, blockquote).

import { useMemo } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";

const ALLOWED_TAGS = [
  "a", "b", "blockquote", "br", "code", "del", "div", "em", "h1", "h2",
  "h3", "h4", "h5", "h6", "hr", "i", "img", "li", "ol", "p", "pre",
  "span", "strong", "sub", "sup", "table", "tbody", "td", "th", "thead",
  "tr", "u", "ul",
];

const ALLOWED_ATTR = ["href", "title", "alt", "src", "target", "rel", "class"];

// Configure marked once at module load. GFM (GitHub-flavored) so
// fenced code, tables, task lists work; breaks=true so single newlines
// in agent output render as <br/> the way users expect from chat
// surfaces.
marked.setOptions({
  gfm: true,
  breaks: true,
});

function renderToSafeHtml(markdown: string): string {
  const dirty = marked.parse(markdown, { async: false }) as string;
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Outbound links open in a new tab safely.
    ADD_ATTR: ["target", "rel"],
  });
}

export interface MarkdownProps {
  /** Markdown source. Empty / null renders nothing. */
  source: string | null | undefined;
  /** Extra Tailwind classes to attach to the prose container. */
  className?: string;
  /** Compact spacing — used in dense surfaces like comment rows. */
  compact?: boolean;
}

const PROSE_CLASS_BASE =
  // Tight, neutral typography. Avoid Tailwind's `prose` plugin so we
  // don't pull a 10kb stylesheet for a few markdown surfaces — set
  // the spacing/typography we actually need explicitly.
  //
  // No `text-{color}` here on purpose: text color is inherited from
  // the parent bubble. That lets Copilot user-message bubbles
  // (white on black) render correctly without fighting a hardcoded
  // dark color. Parents that need a specific color pass it via
  // `className`.
  "text-sm leading-relaxed " +
  "[&_h1]:text-base [&_h1]:font-semibold [&_h1]:mt-3 [&_h1]:mb-1.5 " +
  "[&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 " +
  "[&_h3]:text-sm [&_h3]:font-medium [&_h3]:mt-2 [&_h3]:mb-1 " +
  "[&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 " +
  "[&_ul]:list-disc [&_ul]:ml-5 [&_ul]:my-1.5 " +
  "[&_ol]:list-decimal [&_ol]:ml-5 [&_ol]:my-1.5 " +
  "[&_li]:my-0.5 " +
  "[&_a]:text-blue-600 [&_a]:underline hover:[&_a]:text-blue-700 " +
  "[&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[0.85em] [&_code]:font-mono " +
  "[&_pre]:bg-slate-100 [&_pre]:p-2 [&_pre]:rounded-md [&_pre]:my-2 [&_pre]:overflow-x-auto " +
  "[&_pre>code]:bg-transparent [&_pre>code]:p-0 " +
  "[&_blockquote]:border-l-2 [&_blockquote]:border-slate-200 [&_blockquote]:pl-3 [&_blockquote]:text-slate-600 [&_blockquote]:my-2 " +
  "[&_hr]:border-slate-200 [&_hr]:my-3 " +
  "[&_table]:my-2 [&_th]:border [&_th]:border-slate-200 [&_th]:px-2 [&_th]:py-1 [&_th]:bg-slate-50 [&_th]:font-medium " +
  "[&_td]:border [&_td]:border-slate-200 [&_td]:px-2 [&_td]:py-1";

const PROSE_CLASS_COMPACT =
  "[&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_h1]:mt-1 [&_h1]:mb-1 [&_h2]:mt-1 [&_h2]:mb-1";

export function Markdown({ source, className, compact }: MarkdownProps) {
  const html = useMemo(() => {
    if (!source) return "";
    try {
      return renderToSafeHtml(source);
    } catch {
      // marked occasionally throws on unusual inputs; fall back to
      // raw text rather than blowing up the screen.
      return DOMPurify.sanitize(source.replace(/\n/g, "<br/>"));
    }
  }, [source]);

  if (!html) return null;

  const cls = [
    PROSE_CLASS_BASE,
    compact ? PROSE_CLASS_COMPACT : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  // After sanitization marked-produced links may not have `target`
  // attached — patch that on the DOM level via a one-shot rewrite in
  // the rendered output. Cheap.
  const hardened = html.replace(
    /<a\s/g,
    '<a target="_blank" rel="noopener noreferrer" ',
  );

  return <div className={cls} dangerouslySetInnerHTML={{ __html: hardened }} />;
}
