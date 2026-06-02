import type * as PageTree from "fumadocs-core/page-tree";
import type { IconType } from "react-icons";
import {
  FaBolt,
  FaBook,
  FaBrain,
  FaClock,
  FaCommentDots,
  FaComments,
  FaLightbulb,
  FaPlug,
  FaRocket,
  FaShieldAlt,
  FaTools,
} from "react-icons/fa";
import { source } from "@/lib/source";

const DOC_TITLES = new Map([
  ["/docs", "Welcome"],
  ["/docs/what-is-openloomi", "What is OpenLoomi?"],
  ["/docs/getting-started", "Getting Started"],
  ["/docs/chat", "Chat"],
  ["/docs/connectors", "Connectors"],
  ["/docs/messaging-apps", "Messaging Apps"],
  ["/docs/automation", "Automation"],
  ["/docs/skills", "Skills"],
  ["/docs/library", "Library"],
  ["/docs/memory", "Memory"],
  ["/docs/privacy-security", "Privacy & Security"],
  ["/docs/glossary", "Glossary"],
  ["/docs/use-cases", "Use Cases"],
  ["/docs/changelog", "Changelog"],
  ["/docs/changelog/openloomi-0.5.0", "OpenLoomi 0.5.0"],
  ["/docs/changelog/openloomi-0.4.0", "OpenLoomi 0.4.0"],
  ["/docs/changelog/openloomi-0.3.0", "OpenLoomi 0.3.0"],
  ["/docs/changelog/openloomi-0.2.0", "OpenLoomi 0.2.0"],
  ["/docs/changelog/openloomi-0.1.0", "OpenLoomi 0.1.0"],
]);

const DOC_ICON_NAMES = new Map([
  ["/docs/what-is-openloomi", "FaRocket"],
  ["/docs/getting-started", "FaRocket"],
  ["/docs/chat", "FaComments"],
  ["/docs/connectors", "FaPlug"],
  ["/docs/messaging-apps", "FaCommentDots"],
  ["/docs/automation", "FaClock"],
  ["/docs/skills", "FaTools"],
  ["/docs/library", "FaBook"],
  ["/docs/memory", "FaBrain"],
  ["/docs/privacy-security", "FaShieldAlt"],
  ["/docs/glossary", "FaBook"],
  ["/docs/use-cases", "FaLightbulb"],
  ["/docs/changelog", "FaBolt"],
]);

const DOC_ICONS: Record<string, IconType> = {
  FaBolt,
  FaBook,
  FaBrain,
  FaClock,
  FaCommentDots,
  FaComments,
  FaLightbulb,
  FaPlug,
  FaRocket,
  FaShieldAlt,
  FaTools,
};

function getDocIcon(url: string) {
  const iconName = DOC_ICON_NAMES.get(url);
  const Icon = iconName ? DOC_ICONS[iconName] : undefined;

  return Icon ? (
    <Icon
      className="openloomi-doc-icon"
      style={{ color: "var(--openloomi-fox-yellow, #f5b64a)" }}
      aria-hidden="true"
      focusable="false"
    />
  ) : undefined;
}

function renameNode(node: PageTree.Node): PageTree.Node {
  if (node.type === "page") {
    return {
      ...node,
      name: DOC_TITLES.get(node.url) ?? node.name,
      icon: getDocIcon(node.url),
    };
  }

  if (node.type === "folder") {
    const isChangelogFolder =
      node.$id === "changelog" ||
      node.$ref?.folder === "changelog" ||
      node.index?.url === "/docs/changelog" ||
      node.name === "changelog" ||
      node.name === "Changelog";

    const folderName = node.index
      ? DOC_TITLES.get(node.index.url)
      : node.name === "changelog"
        ? "Changelog"
        : node.name;

    return {
      ...node,
      name: folderName,
      collapsible: isChangelogFolder ? true : node.collapsible,
      defaultOpen: isChangelogFolder ? false : node.defaultOpen,
      index: node.index
        ? ({
            ...node.index,
            name: DOC_TITLES.get(node.index.url) ?? node.index.name,
            icon: getDocIcon(node.index.url),
          } satisfies PageTree.Item)
        : undefined,
      icon: node.index ? getDocIcon(node.index.url) : undefined,
      children: node.children.map(renameNode),
    };
  }

  return node;
}

export function getDocsPageTree(): PageTree.Root {
  const tree = source.getPageTree();

  return {
    ...tree,
    name: "OpenLoomi Docs",
    children: tree.children.map(renameNode),
  };
}
