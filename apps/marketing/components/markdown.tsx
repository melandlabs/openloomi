"use client";

import Link from "next/link";
import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Markdown component config
 */
const components: Partial<Components> = {
  pre: ({ children }) => <div className="mb-4">{children}</div>,
  p: ({ children, ...props }) => {
    return (
      <p
        className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground mb-4"
        {...props}
      >
        {children}
      </p>
    );
  },
  ol: ({ children, ...props }) => {
    return (
      <ol className="list-decimal list-outside ml-6 mb-4 space-y-1" {...props}>
        {children}
      </ol>
    );
  },
  li: ({ children, ...props }) => {
    return (
      <li className="my-1" {...props}>
        {children}
      </li>
    );
  },
  ul: ({ children, ...props }) => {
    return (
      <ul className="list-disc list-outside ml-6 mb-4 space-y-1" {...props}>
        {children}
      </ul>
    );
  },
  strong: ({ children, ...props }) => {
    return (
      <strong className="font-bold" {...props}>
        {children}
      </strong>
    );
  },
  em: ({ children, ...props }) => {
    return (
      <em className="italic" {...props}>
        {children}
      </em>
    );
  },
  blockquote: ({ children, ...props }) => {
    return (
      <blockquote
        className="border-l-4 border-zinc-300 dark:border-zinc-600 pl-4 my-4 italic text-zinc-600 dark:text-zinc-400"
        {...props}
      >
        {children}
      </blockquote>
    );
  },
  a: ({ children, ...props }) => {
    return (
      // @ts-expect-error - Link component props type mismatch with markdown anchor props
      <Link
        className="text-primary hover:underline"
        target="_blank"
        rel="noreferrer"
        {...props}
      >
        {children}
      </Link>
    );
  },
  h1: ({ children, ...props }) => {
    return (
      <h1 className="text-2xl font-bold mb-4 mt-6" {...props}>
        {children}
      </h1>
    );
  },
  h2: ({ children, ...props }) => {
    return (
      <h2 className="text-xl font-bold mb-3 mt-5" {...props}>
        {children}
      </h2>
    );
  },
  h3: ({ children, ...props }) => {
    return (
      <h3 className="text-lg font-bold mb-3 mt-4" {...props}>
        {children}
      </h3>
    );
  },
  h4: ({ children, ...props }) => {
    return (
      <h4 className="text-base font-bold mb-2 mt-4" {...props}>
        {children}
      </h4>
    );
  },
  h5: ({ children, ...props }) => {
    return (
      <h5 className="text-sm font-bold mb-2 mt-4" {...props}>
        {children}
      </h5>
    );
  },
  h6: ({ children, ...props }) => {
    return (
      <h6 className="text-sm font-bold mb-2 mt-4" {...props}>
        {children}
      </h6>
    );
  },
  table: ({ children, ...props }) => {
    return (
      <div className="my-4 overflow-x-auto">
        <table
          className="w-full border-collapse border border-zinc-200 dark:border-zinc-700 text-sm"
          {...props}
        >
          {children}
        </table>
      </div>
    );
  },
  thead: ({ children, ...props }) => {
    return (
      <thead
        className="bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-700"
        {...props}
      >
        {children}
      </thead>
    );
  },
  tbody: ({ children, ...props }) => {
    return <tbody {...props}>{children}</tbody>;
  },
  tr: ({ children, ...props }) => {
    return (
      <tr
        className="border-b border-zinc-200 dark:border-zinc-700 last:border-b-0 hover:bg-zinc-50 dark:hover:bg-zinc-800/30"
        {...props}
      >
        {children}
      </tr>
    );
  },
  th: ({ children, ...props }) => {
    return (
      <th
        className="px-4 py-2 text-left font-semibold text-zinc-900 dark:text-zinc-50"
        {...props}
      >
        {children}
      </th>
    );
  },
  td: ({ children, ...props }) => {
    return (
      <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300" {...props}>
        {children}
      </td>
    );
  },
};

const remarkPlugins = [remarkGfm];

/**
 * Markdown render component (non-memoized version)
 */
const NonMemoizedMarkdown = ({ children }: { children: string }) => {
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
      {children}
    </ReactMarkdown>
  );
};

/**
 * Markdown render component
 * Uses memo for performance, only re-renders when content changes
 */
export const Markdown = memo(
  NonMemoizedMarkdown,
  (prevProps, nextProps) => prevProps.children === nextProps.children,
);
