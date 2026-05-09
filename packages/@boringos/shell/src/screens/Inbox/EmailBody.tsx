// SPDX-License-Identifier: BUSL-1.1
//
// Safe HTML email render — DOMPurify sanitization in a sandboxed
// iframe. Defends the shell against:
//   - XSS via inline scripts / handlers
//   - Cross-window clobbering (iframe sandbox without allow-scripts)
//   - Tracking pixels / open beacons (external images blocked by default)
//   - Phishing redirects (links: rel=noopener noreferrer + target=_blank)
//
// Why iframe + DOMPurify (not just DOMPurify):
//   - Some email HTML carries inline <style> that would otherwise leak
//     into the shell's CSS; iframe scopes it.
//   - Belt-and-suspenders: if a future DOMPurify CVE leaks a tag,
//     the sandbox attribute keeps script execution disabled.

import { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify, { type Config as DOMPurifyConfig } from "dompurify";

export interface EmailBodyProps {
  /** Raw HTML from the Gmail bodyHtml field (preferred). */
  html?: string | null;
  /** Plain text fallback if no HTML is available. */
  text?: string | null;
}

const PURIFY_CONFIG: DOMPurifyConfig = {
  ALLOWED_TAGS: [
    "a", "p", "br", "strong", "em", "b", "i", "u", "s",
    "ul", "ol", "li",
    "blockquote", "pre", "code",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "table", "thead", "tbody", "tr", "td", "th", "tfoot",
    "img", "hr",
    "span", "div",
    "small", "sub", "sup",
    "font",
  ],
  ALLOWED_ATTR: [
    "href", "title", "alt", "src", "data-src",
    "width", "height",
    "colspan", "rowspan",
    "style", "class",
    "color", "face", "size",
  ],
  ALLOW_DATA_ATTR: false,
  // Keep <style> tags but DOMPurify will already strip script-bearing
  // attributes; iframe scopes the cascade.
  FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button"],
  FORBID_ATTR: [
    "onerror", "onload", "onclick", "onmouseover", "onmouseout", "onfocus", "onblur",
  ],
};

interface SanitizeResult {
  html: string;
  /** Number of <img> tags whose external src was hidden behind data-src. */
  blockedImageCount: number;
}

/**
 * Returns sanitized HTML with external `src` attributes hidden behind
 * `data-src` (revealed when the user clicks "Show images"), and links
 * rewritten to open in a new tab. Reports the count of blocked images
 * so the UI can hide the "Show images" toggle on emails that don't
 * have any.
 */
function sanitizeAndRewrite(rawHtml: string, blockImages: boolean): SanitizeResult {
  const cleaned = DOMPurify.sanitize(rawHtml, PURIFY_CONFIG) as unknown as string;

  const tpl = document.createElement("template");
  tpl.innerHTML = cleaned;
  const root = tpl.content;

  let blockedImageCount = 0;
  root.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
    const src = img.getAttribute("src");
    if (!src || src.startsWith("data:") || src.startsWith("cid:")) return;
    if (blockImages) {
      img.setAttribute("data-src", src);
      img.setAttribute(
        "src",
        "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>",
      );
      img.setAttribute("data-blocked", "true");
    }
    blockedImageCount++;
  });

  // Anchors: target=_blank + rel=noopener noreferrer.
  root.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  });

  return { html: tpl.innerHTML, blockedImageCount };
}

export function EmailBody({ html, text }: EmailBodyProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [showImages, setShowImages] = useState(false);
  const [showPlain, setShowPlain] = useState(false);
  const [iframeHeight, setIframeHeight] = useState(200);

  const hasHtml = Boolean(html && html.trim().length > 0);
  const hasText = Boolean(text && text.trim().length > 0);

  const sanitized = useMemo(
    () =>
      hasHtml
        ? sanitizeAndRewrite(html!, !showImages)
        : { html: "", blockedImageCount: 0 },
    [html, hasHtml, showImages],
  );

  const iframeDoc = useMemo(() => {
    if (!sanitized.html) return "";
    // Whole HTML doc so the iframe gets a body context. The CSS
    // sets a clean reading style and disables max-width tricks that
    // could break out of the iframe.
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; padding: 16px; font: 14px/1.55 -apple-system, system-ui, "Segoe UI", Roboto, sans-serif; color: rgb(15, 23, 42); }
  body { word-wrap: break-word; overflow-wrap: anywhere; }
  a { color: rgb(37, 99, 235); }
  a:hover { text-decoration: underline; }
  img { max-width: 100%; height: auto; }
  blockquote { border-left: 3px solid rgb(203, 213, 225); padding-left: 12px; color: rgb(71, 85, 105); margin: 8px 0; }
  table { border-collapse: collapse; max-width: 100%; }
  pre, code { background: rgb(241, 245, 249); padding: 1px 4px; border-radius: 3px; font: 12px ui-monospace, monospace; }
  hr { border: 0; border-top: 1px solid rgb(226, 232, 240); margin: 12px 0; }
</style>
</head>
<body>${sanitized.html}</body>
</html>`;
  }, [sanitized]);

  // Resize iframe to fit content (so the outer scroll handles scroll,
  // not nested iframe scroll — nicer reading flow).
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const resize = () => {
      try {
        const doc = iframe.contentDocument;
        if (!doc) return;
        const next = Math.max(
          doc.documentElement.scrollHeight,
          doc.body.scrollHeight,
        );
        if (next > 0 && Math.abs(next - iframeHeight) > 4) {
          setIframeHeight(next);
        }
      } catch {
        // Same-origin sandbox: iframe contentDocument is accessible.
      }
    };

    iframe.addEventListener("load", resize);
    // Re-measure shortly after load for late-arriving images/fonts.
    const t1 = setTimeout(resize, 200);
    const t2 = setTimeout(resize, 1000);
    return () => {
      iframe.removeEventListener("load", resize);
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iframeDoc]);

  if (!hasHtml && !hasText) {
    return <p className="text-sm text-muted italic">No body content.</p>;
  }

  if (!hasHtml || showPlain) {
    return (
      <div>
        {hasHtml && (
          <button
            type="button"
            onClick={() => setShowPlain(false)}
            className="mb-2 text-[11px] text-muted hover:text-text"
          >
            ← Switch to rich view
          </button>
        )}
        <pre className="text-sm text-text whitespace-pre-wrap font-sans leading-relaxed">
          {text ?? ""}
        </pre>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-2 text-[11px]">
        {!showImages && sanitized.blockedImageCount > 0 && (
          <button
            type="button"
            onClick={() => setShowImages(true)}
            className="text-accent hover:text-accent"
          >
            Show {sanitized.blockedImageCount} image
            {sanitized.blockedImageCount === 1 ? "" : "s"}
          </button>
        )}
        {hasText && (
          <button
            type="button"
            onClick={() => setShowPlain(true)}
            className="text-muted hover:text-text"
          >
            Plain text
          </button>
        )}
      </div>
      <iframe
        ref={iframeRef}
        title="Email body"
        sandbox="allow-same-origin allow-popups"
        srcDoc={iframeDoc}
        style={{
          width: "100%",
          height: `${iframeHeight}px`,
          border: "none",
        }}
      />
    </div>
  );
}
