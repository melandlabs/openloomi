import type React from "react";
import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
// Import remark-gfm directly to bypass Turbopack dynamic import issue
import remarkGfm from "remark-gfm";
import type { Element } from "hast";
import { openUrl } from "@/lib/tauri";

/**
 * Renders inline instruction tokens as badges.
 *
 * Supports:
 * - event: `[[ref:event:id|title]]` (title is optional)
 * - skill: `/skillId` or `/id1/id2` (consecutive tokens are split into multiple badges)
 *
 * Note: This rendering is for "preview/display" scenarios (e.g., right-side buttons in scheduled jobs),
 * does not depend on skill list, so skill badge text uses the `skillId` from the token itself.
 */
function renderInlineInstructionBadges(
  childrenText: string,
): React.ReactNode[] {
  const EVENT_TOKEN_RE = /\[\[ref:event:([^\]]*)\]\]/g;
  const SKILL_TOKEN_RE = /\/([\w-]+)(?=\s|\/|$)/g;

  const badgeBaseClass =
    "inline-flex items-center gap-px rounded-md bg-muted px-[3px] py-px";

  const nodes: React.ReactNode[] = [];
  let cursor = 0;

  // Scan segments using while: each iteration takes the event/skill nearest to cursor.
  // For simplicity and stability, re-execute both regexes each round and compare indices.
  while (cursor < childrenText.length) {
    const eventRe = new RegExp(EVENT_TOKEN_RE.source, "g");
    const skillRe = new RegExp(SKILL_TOKEN_RE.source, "g");
    eventRe.lastIndex = cursor;
    skillRe.lastIndex = cursor;

    const eventMatch = eventRe.exec(childrenText);
    const skillMatch = skillRe.exec(childrenText);

    const next =
      eventMatch && skillMatch
        ? eventMatch.index <= skillMatch.index
          ? {
              kind: "event" as const,
              match: eventMatch,
              index: eventMatch.index,
            }
          : {
              kind: "skill" as const,
              match: skillMatch,
              index: skillMatch.index,
            }
        : eventMatch
          ? {
              kind: "event" as const,
              match: eventMatch,
              index: eventMatch.index,
            }
          : skillMatch
            ? {
                kind: "skill" as const,
                match: skillMatch,
                index: skillMatch.index,
              }
            : null;

    if (!next) {
      nodes.push(childrenText.slice(cursor));
      break;
    }

    if (next.index > cursor) {
      nodes.push(childrenText.slice(cursor, next.index));
    }

    if (next.kind === "event") {
      const label = next.match[1] ?? "";
      const [idRaw, ...rest] = label.split("|");
      const eventId = (idRaw ?? "").trim();
      const title = rest.join("|").trim() || eventId;

      nodes.push(
        <span
          key={`event-${eventId}-${next.index}`}
          className={badgeBaseClass}
          data-badge-kind="event"
          data-badge-id={eventId}
        >
          <i className="ri-radar-line" />
          <span className="flex-1 min-w-0 truncate whitespace-nowrap">
            {title}
          </span>
        </span>,
      );
    } else {
      const skillId = next.match[1] ?? "";
      if (!skillId) {
        nodes.push("/");
      } else {
        nodes.push(
          <span
            key={`skill-${skillId}-${next.index}`}
            className={badgeBaseClass}
            data-badge-kind="skill"
            data-badge-id={skillId}
          >
            <i className="ri-apps-2-ai-line" />
            <span className="flex-1 min-w-0 truncate whitespace-nowrap">
              {skillId}
            </span>
          </span>,
        );
      }
    }

    cursor = next.index + next.match[0].length;
  }

  return nodes;
}

/**
 * Uniformly renders inline badge for ReactMarkdown paragraph children (string array/mixed nodes).
 */
function renderInlineInstructionBadgesFromNode(
  children: React.ReactNode,
  renderInstructionBadges = true,
): React.ReactNode {
  if (!renderInstructionBadges) {
    return children;
  }
  if (typeof children === "string") {
    return renderInlineInstructionBadges(children);
  }
  if (Array.isArray(children)) {
    return children.map((child, idx) => {
      if (typeof child === "string") {
        // Biome forbids array indices as keys; string content itself is relatively stable here.
        return <span key={child}>{renderInlineInstructionBadges(child)}</span>;
      }
      return child;
    });
  }
  return children;
}

interface MarkdownProps {
  children: string;
  renderInstructionBadges?: boolean;
}

/**
 * Returns true if the children contain a block-level element (e.g. a <pre>
 * or <div> from a fenced code block). These cannot be nested inside a <p>.
 */
function hasBlockChild(children: React.ReactNode): boolean {
  if (Array.isArray(children)) {
    return children.some(
      (child) =>
        typeof child === "object" &&
        child !== null &&
        "type" in child &&
        typeof child.type === "string" &&
        /^(pre|div|p|h[1-6]|ul|ol|table|blockquote)$/.test(child.type),
    );
  }
  if (
    typeof children === "object" &&
    children !== null &&
    "type" in children &&
    typeof (children as React.ReactElement).type === "string" &&
    /^(pre|div|p|h[1-6]|ul|ol|table|blockquote)$/.test(
      (children as React.ReactElement).type as string,
    )
  ) {
    return true;
  }
  return false;
}

/** Inline code renderer (for `code` inside `p`). */
function InlineCode({
  className,
  children,
  ...props
}: React.ComponentProps<"code">) {
  return (
    <code
      className={`${className ?? ""} text-sm bg-zinc-100 dark:bg-zinc-800 py-0.5 px-1 rounded-md`}
      {...props}
    >
      {children}
    </code>
  );
}

function createComponents(
  renderInstructionBadges: boolean,
): Partial<Components> {
  return {
    code: ({ children, className, ...props }) => {
      // Inline code only — block-level fenced code blocks are handled in `pre`.
      return (
        <InlineCode className={className} {...props}>
          {children}
        </InlineCode>
      );
    },
    pre: ({ node, children, ...props }) => {
      // Fenced code block: `pre` wraps a `code` element as its first child.
      const codeNode = (node as Element | undefined)?.children?.[0] as
        | Element
        | undefined;
      const lang =
        (codeNode?.properties?.className as string[] | undefined)
          ?.find((c) => c.startsWith("language-"))
          ?.replace("language-", "") ?? "";

      return (
        <div className="not-prose flex flex-col min-w-0">
          <pre
            {...props}
            className={
              "text-sm w-full overflow-x-auto dark:bg-zinc-900 p-4 border border-zinc-200 dark:border-zinc-700 rounded-xl dark:text-zinc-50 text-zinc-900"
            }
          >
            <code
              className="whitespace-pre font-mono min-w-0"
              data-language={lang}
            >
              {children}
            </code>
          </pre>
        </div>
      );
    },
    p: ({ node, children, ...props }) => {
      // If children contain block-level elements (e.g. a fenced code block
      // that somehow leaked in), render them unwrapped to avoid invalid HTML.
      if (hasBlockChild(children)) {
        return <>{children}</>;
      }
      const content = renderInlineInstructionBadgesFromNode(
        children,
        renderInstructionBadges,
      );
      return (
        <p
          className="!mb-0 leading-relaxed text-[14px] text-zinc-950 dark:text-zinc-50 min-w-0 [&:not(:first-child)]:mt-3"
          {...props}
        >
          {content}
        </p>
      );
    },
    ol: ({ node, children, ...props }) => {
      return (
        <ol
          className="list-decimal list-outside ml-6 mb-4 space-y-1 min-w-0"
          {...props}
        >
          {children}
        </ol>
      );
    },
    li: ({ node, children, ...props }) => {
      const content = renderInlineInstructionBadgesFromNode(
        children,
        renderInstructionBadges,
      );
      return (
        <li className="my-1 leading-relaxed break-words min-w-0" {...props}>
          {content}
        </li>
      );
    },
    ul: ({ node, children, ...props }) => {
      return (
        <ul
          className="list-disc list-outside ml-6 mb-4 space-y-1 min-w-0"
          {...props}
        >
          {children}
        </ul>
      );
    },
    strong: ({ node, children, ...props }) => {
      return (
        <span className="font-semibold" {...props}>
          {children}
        </span>
      );
    },
    a: ({ node, children, href, ...props }) => {
      const handleClick = (e: React.MouseEvent) => {
        e.preventDefault();
        if (href) {
          openUrl(href);
        }
      };
      return (
        <button
          className="text-blue-500 hover:underline cursor-pointer bg-transparent border-none p-0 text-left"
          onClick={handleClick}
          {...(props as React.ComponentProps<"button">)}
        >
          {children}
        </button>
      );
    },
    h1: ({ node, children, ...props }) => {
      return (
        <h1 className="text-2xl font-bold mb-4 mt-6" {...props}>
          {children}
        </h1>
      );
    },
    h2: ({ node, children, ...props }) => {
      return (
        <h2 className="text-xl font-bold mb-3 mt-5" {...props}>
          {children}
        </h2>
      );
    },
    h3: ({ node, children, ...props }) => {
      return (
        <h3 className="text-lg font-bold mb-3 mt-4" {...props}>
          {children}
        </h3>
      );
    },
    h4: ({ node, children, ...props }) => {
      return (
        <h4 className="text-base font-bold mb-2 mt-4" {...props}>
          {children}
        </h4>
      );
    },
    h5: ({ node, children, ...props }) => {
      return (
        <h5 className="text-sm font-bold mb-2 mt-4" {...props}>
          {children}
        </h5>
      );
    },
    h6: ({ node, children, ...props }) => {
      return (
        <h6 className="text-sm font-bold mb-2 mt-4" {...props}>
          {children}
        </h6>
      );
    },
    table: ({ node, children, ...props }) => {
      return (
        <div className="my-4 overflow-x-auto min-w-0">
          <table
            className="min-w-full border-collapse border border-zinc-200 dark:border-zinc-700 text-sm"
            {...props}
          >
            {children}
          </table>
        </div>
      );
    },
    thead: ({ node, children, ...props }) => {
      return (
        <thead
          className="bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-700"
          {...props}
        >
          {children}
        </thead>
      );
    },
    tbody: ({ node, children, ...props }) => {
      return <tbody {...props}>{children}</tbody>;
    },
    tr: ({ node, children, ...props }) => {
      return (
        <tr
          className="border-b border-zinc-200 dark:border-zinc-700 last:border-b-0 hover:bg-zinc-50 dark:hover:bg-zinc-800/30"
          {...props}
        >
          {children}
        </tr>
      );
    },
    th: ({ node, children, ...props }) => {
      return (
        <th
          className="px-4 py-2 text-left font-semibold text-zinc-900 dark:text-zinc-50"
          {...props}
        >
          {children}
        </th>
      );
    },
    td: ({ node, children, ...props }) => {
      return (
        <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300" {...props}>
          {children}
        </td>
      );
    },
    blockquote: ({ node, children, ...props }) => {
      return (
        <blockquote
          className="border-l-4 border-zinc-300 dark:border-zinc-600 pl-4 my-4 italic text-zinc-600 dark:text-zinc-400"
          {...props}
        >
          {children}
        </blockquote>
      );
    },
  };
}

const NonMemoizedMarkdown = ({
  children,
  renderInstructionBadges = true,
}: MarkdownProps) => {
  const remarkPlugins = [remarkGfm];
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      components={createComponents(renderInstructionBadges)}
      className="markdown-wrapper"
    >
      {children}
    </ReactMarkdown>
  );
};

export const Markdown = memo(
  NonMemoizedMarkdown,
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    prevProps.renderInstructionBadges === nextProps.renderInstructionBadges,
);
