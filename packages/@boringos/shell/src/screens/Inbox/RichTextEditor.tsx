// SPDX-License-Identifier: BUSL-1.1
//
// Tiptap-backed rich text editor for the reply composer. Plain
// `<textarea>` was the wrong default for a CRM — recipients judge
// the sender by the formatting of what they receive, and plain text
// reads as broken in 2026.
//
// What's wired:
//   - StarterKit (paragraphs, bold, italic, lists, code, headings,
//     link extension separately for prompt-driven URL entry)
//   - Link extension with safe defaults (target=_blank, rel=noopener)
//   - Placeholder extension for the empty-editor hint
//   - Keyboard shortcuts: Cmd+B, Cmd+I, Cmd+K (link prompt),
//     Cmd+Shift+7/8 (lists) — all out of the box.
//
// What's NOT wired (intentional, will land later if needed):
//   - Paste-from-Word cleanup (current paste handler keeps inline
//     styles; the send-time DOMPurify sanitizer strips dangerous bits)
//   - Inline image upload (separate Gmail attachment plumbing)
//   - Mention chips / autocomplete

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect } from "react";

export interface RichTextEditorProps {
  /** Initial HTML; only consumed on first render. Subsequent
   *  `value` changes are ignored — the editor owns its state to
   *  avoid cursor jumps on every keystroke. */
  initialHtml: string;
  /** Fires on every change with the latest HTML. */
  onChange: (html: string) => void;
  /** Placeholder shown when the editor is empty. */
  placeholder?: string;
  /** Disable input. Keeps content visible. */
  disabled?: boolean;
  /** When set, the next render replaces the editor's content with
   *  this HTML and resets the cursor to the top. Use this to swap a
   *  draft into an existing editor instance without remounting (e.g.
   *  "Use this draft" button on the inbox detail). */
  resetKey?: string | number;
}

const TOOLBAR_BUTTON =
  "px-2 py-1 text-xs rounded-md text-text-secondary hover:bg-bg-warm disabled:opacity-40 disabled:hover:bg-transparent transition";
const TOOLBAR_BUTTON_ACTIVE =
  "px-2 py-1 text-xs rounded-md bg-accent text-white hover:bg-accent-light";

export function RichTextEditor({
  initialHtml,
  onChange,
  placeholder,
  disabled,
  resetKey,
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Drop heading from the starter so the toolbar stays scoped to
        // inline formatting — replies aren't the place for H1s.
        heading: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          rel: "noopener noreferrer",
          target: "_blank",
        },
      }),
      Placeholder.configure({
        placeholder: placeholder ?? "Write your reply…",
      }),
    ],
    content: initialHtml,
    editable: !disabled,
    editorProps: {
      attributes: {
        class:
          "min-h-[180px] max-h-[360px] overflow-auto px-3 py-2 text-sm text-text leading-relaxed focus:outline-none prose prose-sm max-w-none",
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
  });

  // Apply pending resets without remounting the editor.
  useEffect(() => {
    if (!editor) return;
    if (resetKey === undefined) return;
    editor.commands.setContent(initialHtml, false);
    editor.commands.focus("start");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // Toggle editable when the parent flips `disabled` (e.g. while busy
  // sending). Tiptap tracks editable as instance state.
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  if (!editor) return null;

  const promptForLink = () => {
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previous ?? "");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div className="rounded-md border border-border focus-within:ring-2 focus-within:ring-accent/40 bg-white">
      <div className="flex items-center gap-1 border-b border-border-subtle px-1.5 py-1">
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          disabled={disabled}
          className={editor.isActive("bold") ? TOOLBAR_BUTTON_ACTIVE : TOOLBAR_BUTTON}
          aria-label="Bold"
          title="Bold (⌘B)"
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          disabled={disabled}
          className={editor.isActive("italic") ? TOOLBAR_BUTTON_ACTIVE : TOOLBAR_BUTTON}
          aria-label="Italic"
          title="Italic (⌘I)"
        >
          <em>I</em>
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleStrike().run()}
          disabled={disabled}
          className={editor.isActive("strike") ? TOOLBAR_BUTTON_ACTIVE : TOOLBAR_BUTTON}
          aria-label="Strikethrough"
        >
          <s>S</s>
        </button>
        <span className="mx-1 h-4 w-px bg-border-subtle" aria-hidden />
        <button
          type="button"
          onClick={promptForLink}
          disabled={disabled}
          className={editor.isActive("link") ? TOOLBAR_BUTTON_ACTIVE : TOOLBAR_BUTTON}
          title="Link (⌘K)"
        >
          Link
        </button>
        <span className="mx-1 h-4 w-px bg-border-subtle" aria-hidden />
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          disabled={disabled}
          className={editor.isActive("bulletList") ? TOOLBAR_BUTTON_ACTIVE : TOOLBAR_BUTTON}
          title="Bullet list"
        >
          • List
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          disabled={disabled}
          className={editor.isActive("orderedList") ? TOOLBAR_BUTTON_ACTIVE : TOOLBAR_BUTTON}
          title="Numbered list"
        >
          1. List
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          disabled={disabled}
          className={editor.isActive("blockquote") ? TOOLBAR_BUTTON_ACTIVE : TOOLBAR_BUTTON}
          title="Quote"
        >
          ❝
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
