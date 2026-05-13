"use client";

import type React from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Toggle } from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

interface RichTextEditorProps {
  content: string;
  onChange: (content: string) => void;
  placeholder?: string;
  onAttach?: () => void;
  onPaste?: (event: React.ClipboardEvent<HTMLDivElement>) => void;
  className?: string;
  disabled?: boolean;
  toolbarRight?: React.ReactNode;
  sendButton?: React.ReactNode;
  statusText?: React.ReactNode;
  /**
   * Content to insert before the editor content area
   */
  contentBefore?: React.ReactNode;
}

export function RichTextEditor({
  content,
  onChange,
  placeholder = "Type your reply...",
  onAttach,
  onPaste,
  className,
  disabled = false,
  toolbarRight,
  sendButton,
  statusText,
  contentBefore,
}: RichTextEditorProps) {
  const { t } = useTranslation();
  const toolbarScrollRef = useRef<HTMLDivElement>(null);

  /**
   * Handle toolbar horizontal scrolling, optimize scroll smoothness
   */
  useEffect(() => {
    const element = toolbarScrollRef.current;
    if (!element) return;

    const handleWheel = (e: WheelEvent) => {
      // Check for horizontal scroll (deltaX is not 0)
      // Or vertical scroll when holding Shift key (convert to horizontal scroll)
      const hasHorizontalScroll =
        Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey;

      if (hasHorizontalScroll) {
        // Prevent default vertical scroll behavior
        e.preventDefault();

        // Calculate scroll distance, optimize scroll speed and smoothness
        // Use a smaller coefficient for finer control while maintaining responsiveness
        const scrollAmount = e.shiftKey ? e.deltaY * 1.2 : e.deltaX * 1.2;

        // Execute horizontal scroll, use smooth behavior for smoother experience
        element.scrollBy({
          left: scrollAmount,
          behavior: "smooth",
        });
      }
    };

    element.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      element.removeEventListener("wheel", handleWheel);
    };
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false, // We might not need headings for simple replies
        codeBlock: false, // Use inline code for now, or enable if needed
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "text-primary underline hover:no-underline",
        },
      }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass:
          "before:content-[attr(data-placeholder)] before:text-muted-foreground before:float-left before:pointer-events-none before:h-0",
      }),
    ],
    content,
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-sm max-w-none focus:outline-none min-h-[80px]",
          "prose-p:my-1 prose-headings:my-2 prose-blockquote:border-l-2 prose-blockquote:border-primary/50 prose-blockquote:text-muted-foreground prose-blockquote:pl-2 prose-blockquote:italic",
          "prose-ul:my-1 prose-ol:my-1 prose-li:my-0",
          disabled && "opacity-50 pointer-events-none",
        ),
      },
      handlePaste: (view, event) => {
        // If onPaste callback is provided, call it first to handle files
        if (onPaste && event.clipboardData) {
          const items = event.clipboardData.items;
          // Check if there are files in clipboard
          const hasFiles = Array.from(items).some(
            (item) => item.kind === "file",
          );
          if (hasFiles) {
            // Create mock clipboard event
            const mockEvent = {
              preventDefault: () => {},
              clipboardData: event.clipboardData,
            } as unknown as React.ClipboardEvent<HTMLDivElement>;
            onPaste(mockEvent);
            // Return true to prevent default paste behavior (since file has been handled)
            return true;
          }
        }

        // Handle text/html paste - use TipTap's insertContent for proper HTML parsing
        const clipboardData = event.clipboardData;
        if (clipboardData) {
          const htmlContent = clipboardData.getData("text/html");
          const textContent = clipboardData.getData("text/plain");

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const editor = (view as any).editor;
          if (!editor) return false;

          if (htmlContent) {
            // Insert HTML content using TipTap's built-in parser
            editor.commands.insertContent(htmlContent, {
              parseOptions: {
                preserveWhitespace: "full",
              },
            });
            return true;
          } else if (textContent) {
            // Fallback to plain text if no HTML
            editor.commands.insertContent(textContent);
            return true;
          }
        }

        // Return false to continue with default paste behavior for other cases
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editable: !disabled,
  });

  // Sync content updates from parent if needed (e.g. AI draft application)
  // Be careful with loops; mostly we just want to set content if it changes externally significantly
  // or if it's cleared.
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      // Basic check to avoid cursor jumping on every keystroke if parent updates too fast
      // But for "setting draft", usually content is completely replaced or initially set.
      // If content is empty string, clear editor.
      if (content === "") {
        editor.commands.clearContent();
      } else if (editor.isEmpty && content) {
        editor.commands.setContent(content);
      }
      // If content changes externally and is not empty, we might need more complex diffing,
      // but for now let's assume parent only updates on load or clear or AI replace.
      else if (content !== editor.getHTML()) {
        // This is risky for typing, so only do it if the diff is large or specific flags?
        // For now, let's rely on the parent NOT updating `content` prop on every keystroke
        // OR we only setContent if it's excessively different.
        // A safe pattern for controlled inputs in Tiptap is difficult.
        // Let's assume `content` prop is primarily for initial value or forced updates (AI).
        // We will NOT auto-update if editor is focused to prevent cursor jump, unless simple mismatch.
        if (!editor.isFocused) {
          editor.commands.setContent(content);
        }
      }
    }
  }, [content, editor]);

  if (!editor) {
    return null;
  }

  const setLink = () => {
    const previousUrl = editor.getAttributes("link").href;
    const url = window.prompt("URL", previousUrl);

    // cancelled
    if (url === null) {
      return;
    }

    // empty
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }

    // update
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border border-border/50 bg-white/95 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/40 transition-colors relative w-full overflow-hidden",
        className,
      )}
    >
      <div className="relative w-full overflow-hidden">
        <div className="px-3 py-2 text-sm max-h-[300px] overflow-y-auto min-h-[160px] w-full overflow-x-hidden">
          {contentBefore}
          <div className="w-full overflow-hidden">
            <EditorContent editor={editor} />
          </div>
        </div>
        {statusText && (
          <div className="absolute bottom-2 right-2 flex items-center gap-2">
            <div className="text-[10px] text-muted-foreground">
              {statusText}
            </div>
          </div>
        )}
      </div>
      <div
        className="flex items-center gap-1 border-t border-border/40 px-2 py-1 overflow-hidden flex-nowrap"
        style={{
          maxWidth: "100%",
          width: "100%",
          boxSizing: "border-box",
          flexShrink: 0,
        }}
      >
        {/* Left toolbar area: scrollable, always hide scrollbar */}
        <div
          ref={toolbarScrollRef}
          role="region"
          aria-label="Toolbar tools"
          className={cn(
            "flex items-center gap-1",
            "min-w-0 flex-1",
            // Support horizontal scroll
            "overflow-x-auto",
            // Optimize scroll smoothness
            "scroll-smooth",
            // Always hide scrollbar (WebKit browsers)
            "[&::-webkit-scrollbar]:hidden",
          )}
          style={{
            // Firefox and Edge: always hide scrollbar
            scrollbarWidth: "none",
            // Ensure smooth scrolling
            WebkitOverflowScrolling: "touch",
            // Prevent container from expanding
            flexBasis: 0,
          }}
        >
          <Toggle
            size="sm"
            pressed={editor.isActive("bold")}
            onPressedChange={() => editor.chain().focus().toggleBold().run()}
            aria-label={t("common.richTextEditor.bold", "Bold")}
            className="h-5 w-5 p-0 shrink-0 data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
            title={t("common.richTextEditor.bold", "Bold")}
          >
            <RemixIcon name="bold" size="size-3" />
          </Toggle>
          <Toggle
            size="sm"
            pressed={editor.isActive("italic")}
            onPressedChange={() => editor.chain().focus().toggleItalic().run()}
            aria-label={t("common.richTextEditor.italic", "Italic")}
            className="h-5 w-5 p-0 shrink-0 data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
            title={t("common.richTextEditor.italic", "Italic")}
          >
            <RemixIcon name="italic" size="size-3" />
          </Toggle>
          <Toggle
            size="sm"
            pressed={editor.isActive("bulletList")}
            onPressedChange={() =>
              editor.chain().focus().toggleBulletList().run()
            }
            aria-label={t("common.richTextEditor.bulletList", "Bullet list")}
            className="h-5 w-5 p-0 shrink-0 data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
            title={t("common.richTextEditor.bulletList", "Bullet list")}
          >
            <RemixIcon name="list" size="size-3" />
          </Toggle>
          <Toggle
            size="sm"
            pressed={editor.isActive("orderedList")}
            onPressedChange={() =>
              editor.chain().focus().toggleOrderedList().run()
            }
            aria-label={t("common.richTextEditor.orderedList", "Ordered list")}
            className="h-5 w-5 p-0 shrink-0 data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
            title={t("common.richTextEditor.orderedList", "Ordered list")}
          >
            <RemixIcon name="list_ordered" size="size-3" />
          </Toggle>

          {onAttach && (
            <Toggle
              size="sm"
              pressed={false}
              onPressedChange={onAttach}
              aria-label={t("common.richTextEditor.attach", "Attach file")}
              className="h-5 w-5 p-0 shrink-0 hover:bg-muted text-muted-foreground hover:text-foreground"
              title={t("common.richTextEditor.attach", "Attach file")}
            >
              <RemixIcon name="image" size="size-3" />
            </Toggle>
          )}
        </div>

        {/* Right area: fixed, no scroll (AI features + send button) */}
        {toolbarRight && (
          <div className="flex items-center gap-1 shrink-0">{toolbarRight}</div>
        )}
        {sendButton && (
          <div className="flex items-center gap-1 shrink-0">{sendButton}</div>
        )}
      </div>
    </div>
  );
}
