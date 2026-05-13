"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Input } from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import { cn } from "@/lib/utils";

/**
 * Normalizes tag value
 */
function normalizeTagValue(value: string) {
  return value.trim();
}

/**
 * Tag editor component props
 */
interface TagEditorProps {
  /** Tag label */
  label: string;
  /** Tag description */
  description: string;
  /** Current tag values list */
  values: string[];
  /** Input value (optional, for external control) */
  inputValue?: string;
  /** Input value change callback (optional, for external control) */
  onInputChange?: (value: string) => void;
  /** Input placeholder */
  placeholder: string;
  /** Clickable example phrases appended after description (link style, click to fill input) */
  inlineExamplePhrases?: string[];
  /** Lead-in text before clickable examples, e.g. "(for example," */
  inlineExampleIntro?: string;
  /** Closing text after clickable examples, e.g. ")" */
  inlineExampleOutro?: string;
  /** Custom header content (optional) */
  header?: ReactNode;
  /** Tag change callback */
  onChange: (values: string[]) => void;
}

/**
 * Tag editor component
 * Used for editing people of interest and topic tags
 * Supports drag-to-reorder
 */
export function TagEditor({
  label,
  description,
  values,
  inputValue: externalInputValue,
  onInputChange: externalOnInputChange,
  placeholder,
  inlineExamplePhrases,
  inlineExampleIntro,
  inlineExampleOutro,
  header,
  onChange,
}: TagEditorProps) {
  const [internalInputValue, setInternalInputValue] = useState("");

  // Use externally provided value or internal state
  const inputValue = externalInputValue ?? internalInputValue;
  const setInputValue = externalOnInputChange ?? setInternalInputValue;

  // Drag state
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  useEffect(() => {
    // Only reset input when value changes and no external control
    if (!externalOnInputChange) {
      setInternalInputValue("");
    }
  }, [values, externalOnInputChange]);

  /**
   * Apply tag value
   */
  const applyValue = (value: string) => {
    const normalized = normalizeTagValue(value);
    if (!normalized) return false;
    if (values.includes(normalized)) {
      return false;
    }
    onChange([...values, normalized]);
    return true;
  };

  /**
   * Add tag
   */
  const addValue = () => {
    const added = applyValue(inputValue);
    if (added) {
      if (externalOnInputChange) {
        externalOnInputChange("");
      } else {
        setInternalInputValue("");
      }
    }
  };

  /**
   * Handle keyboard event
   */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addValue();
    }
  };

  /**
   * Handle blur event
   */
  const handleBlur = () => {
    addValue();
  };

  /**
   * Handle example/link click: fill text into input
   */
  const handleInlineExampleClick = (phrase: string) => {
    setInputValue(phrase);
  };

  /**
   * Handle drag start
   */
  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
    // Set drag image opacity to provide visual feedback
    if (e.dataTransfer.setDragImage) {
      const target = e.target as HTMLElement;
      e.dataTransfer.setDragImage(target, 0, 0);
    }
  }, []);

  /**
   * Handle drag end
   */
  const handleDragEnd = useCallback(() => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  }, []);

  /**
   * Handle drag over
   */
  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      if (draggedIndex === null || draggedIndex === index) {
        return;
      }
      e.dataTransfer.dropEffect = "move";
      setDragOverIndex(index);
    },
    [draggedIndex],
  );

  /**
   * Handle drag leave
   */
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear state when actually leaving the drag area
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;

    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
      setDragOverIndex(null);
    }
  }, []);

  /**
   * Handle drop
   */
  const handleDrop = useCallback(
    (e: React.DragEvent, targetIndex: number) => {
      e.preventDefault();
      e.stopPropagation();

      if (draggedIndex === null || draggedIndex === targetIndex) {
        setDraggedIndex(null);
        setDragOverIndex(null);
        return;
      }

      // Create new array and reorder
      const newValues = [...values];
      const [removed] = newValues.splice(draggedIndex, 1);
      newValues.splice(targetIndex, 0, removed);

      onChange(newValues);
      setDraggedIndex(null);
      setDragOverIndex(null);
    },
    [draggedIndex, values, onChange],
  );

  return (
    <div className="space-y-3">
      {header}
      {(label || description) && (
        <div>
          {label && (
            <p className="text-sm font-semibold text-foreground mb-2">
              {label}
            </p>
          )}
          {description && (
            <p className="text-xs text-muted-foreground">
              {description}
              {inlineExampleIntro &&
                inlineExamplePhrases &&
                inlineExamplePhrases.length > 0 && (
                  <>
                    {inlineExampleIntro}
                    {inlineExamplePhrases.map((phrase, i) => (
                      <span key={phrase}>
                        {i > 0 && ", "}
                        <button
                          type="button"
                          onClick={() => handleInlineExampleClick(phrase)}
                          className="text-xs text-primary underline underline-offset-2 hover:text-primary/80 cursor-pointer"
                        >
                          {phrase}
                        </button>
                      </span>
                    ))}
                    {inlineExampleOutro}
                  </>
                )}
            </p>
          )}
        </div>
      )}
      <div className="flex items-center gap-2 rounded-lg border bg-card p-4">
        <Input
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={placeholder}
          className="h-8 min-w-0 flex-1 border-none bg-transparent px-0 text-sm focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
        />
        <button
          type="button"
          onClick={addValue}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-input bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Add"
          title="Add"
        >
          <RemixIcon name="add" size="size-4" />
        </button>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {values.map((value, index) => {
            const isDragging = draggedIndex === index;
            const isDragOver = dragOverIndex === index;

            return (
              <div
                key={value}
                role="button"
                tabIndex={0}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border bg-secondary px-3 py-1 cursor-move transition-colors",
                  isDragging && "opacity-50",
                  isDragOver && "bg-primary/20 border-primary",
                )}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, index)}
              >
                <RemixIcon
                  name="grip_vertical"
                  size="size-3"
                  className="text-muted-foreground shrink-0"
                />
                <span className="text-sm">{value}</span>
                <button
                  type="button"
                  className="ml-1 rounded-full p-0.5 transition hover:bg-muted"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(values.filter((current) => current !== value));
                  }}
                  aria-label={`Remove ${value}`}
                  title="Delete"
                >
                  <RemixIcon name="close" size="size-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
