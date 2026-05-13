"use client";

import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
  vscDarkPlus,
  vs,
} from "react-syntax-highlighter/dist/esm/styles/prism";
import { useState, useCallback } from "react";
import { RemixIcon } from "@/components/remix-icon";
import { Button } from "@openloomi/ui";
import { cn } from "@/lib/utils";

/**
 * Language mapping
 * Auto-detect programming language based on file extension
 */
const LANGUAGE_MAP: Record<string, string> = {
  // Web frontend
  js: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",

  // Backend
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  c: "c",
  cs: "csharp",
  php: "php",

  // Scripts and config
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  json: "json",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  sql: "sql",

  // Other
  md: "markdown",
  txt: "text",
  markdown: "markdown",
  dockerfile: "docker",
  docker: "docker",
};

/**
 * Get language type
 * Infer programming language from filename or extension
 */
function getLanguage(filename?: string): string {
  if (!filename) return "text";

  const ext = filename.split(".").pop()?.toLowerCase();
  if (!ext) return "text";

  return LANGUAGE_MAP[ext] || "text";
}

interface CodePreviewProps {
  code: string;
  filename?: string;
  language?: string;
  className?: string;
  showLineNumbers?: boolean;
  wrapLines?: boolean;
  maxHeight?: string;
}

/**
 * Code preview component
 *
 * Supports syntax highlighting, line number display, code copy, and other features
 */
export function CodePreview({
  code,
  filename,
  language: propLanguage,
  className,
  showLineNumbers = true,
  wrapLines = false,
  maxHeight = "600px",
}: CodePreviewProps) {
  const [copied, setCopied] = useState(false);

  const language = propLanguage || getLanguage(filename);
  const isDark = document.documentElement.classList.contains("dark");

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  return (
    <div className={cn("relative group", className)}>
      {/* Copy button */}
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity z-10"
        onClick={handleCopy}
      >
        {copied ? (
          <RemixIcon name="check" size="size-4" className="text-green-500" />
        ) : (
          <RemixIcon name="file_copy" size="size-4" />
        )}
      </Button>

      {/* Code content */}
      <div className="overflow-auto rounded-lg" style={{ maxHeight }}>
        <SyntaxHighlighter
          language={language}
          style={isDark ? vscDarkPlus : vs}
          showLineNumbers={showLineNumbers}
          wrapLines={wrapLines}
          customStyle={{
            margin: 0,
            borderRadius: "0.5rem",
            fontSize: "0.875rem",
            lineHeight: "1.6",
          }}
          lineNumberStyle={{
            color: isDark ? "#858585" : "#999",
            fontSize: "0.75rem",
            marginRight: "1.25rem",
            paddingRight: "0.75rem",
            lineHeight: "1.6",
            minWidth: "3rem",
            textAlign: "right",
          }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
