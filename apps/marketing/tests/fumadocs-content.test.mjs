import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const docsDir = path.join(root, "content");
const blogsDir = path.join(root, "blogs");
const docsPageTreePath = path.join(root, "lib", "docs-page-tree.tsx");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseFrontmatter(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  return Object.fromEntries(
    match[1]
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/))
      .filter(Boolean)
      .map(([, key, value]) => [key, value.trim().replace(/^["']|["']$/g, "")]),
  );
}

function countMarkdownH1(filePath) {
  const source = fs
    .readFileSync(filePath, "utf8")
    .replace(/^---\r?\n[\s\S]*?\r?\n---/, "")
    .replace(/```[\s\S]*?```/g, "");

  return source.split("\n").filter((line) => /^#(?!#)\s+/.test(line.trim()))
    .length;
}

function assertMetaPages(metaPath, baseDir) {
  const meta = readJson(metaPath);

  assert.ok(Array.isArray(meta.pages), `${metaPath} must define pages[]`);

  for (const page of meta.pages) {
    const candidates = [
      path.join(baseDir, `${page}.mdx`),
      path.join(baseDir, page, "index.mdx"),
    ];

    assert.ok(
      candidates.some((candidate) => fs.existsSync(candidate)),
      `${page} in ${metaPath} must resolve to an MDX page`,
    );
  }
}

function listDirectories(rootDir) {
  const directories = [rootDir];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      directories.push(...listDirectories(path.join(rootDir, entry.name)));
    }
  }
  return directories;
}

// Pages that are exempt from the description / Related requirement — changelog
// release pages follow a different template.
const CHANGELOG_RELEASE_PAGES = new Set([
  "openloomi-0.1.0",
  "openloomi-0.2.0",
  "openloomi-0.3.0",
  "openloomi-0.4.0",
  "openloomi-0.5.0",
  "openloomi-0.6.0",
  "openloomi-0.7.0",
  "openloomi-0.8.0",
]);

function fileRelativeSlug(filePath, baseDir) {
  const relative = path.relative(baseDir, filePath).replace(/\.mdx$/, "");
  return relative.split(path.sep).join("/");
}

function hasTailSection(source, headings) {
  // Strip frontmatter and code fences before scanning headings.
  const stripped = source
    .replace(/^---\r?\n[\s\S]*?\r?\n---/, "")
    .replace(/```[\s\S]*?```/g, "");

  const headingSet = new Set(headings);
  return stripped.split(/\r?\n/).some((line) => {
    const match = line.match(/^##\s+(.+?)\s*$/);
    if (!match) return false;
    return headingSet.has(match[1].replace(/[\[\]\(\)]/g, "").trim());
  });
}

function listMdxFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".mdx"))
    .map((file) => path.join(dir, file));
}

function collectAllMdxFiles(rootDir) {
  return listDirectories(rootDir).flatMap((dir) => listMdxFiles(dir));
}

function resolveInternalLink(slug) {
  // Strip query string + fragment.
  const [clean] = slug.split(/[?#]/);
  if (!clean) return null;

  // External link.
  if (/^[a-z]+:\/\//i.test(clean)) return null;

  // Skip anchors-only links.
  if (clean.startsWith("#")) return null;

  // Internal docs links are anchored on `/docs/...` and live under `content/`.
  // Strip the leading `/docs` so the relative path matches the file layout.
  const withoutDocsPrefix = clean.replace(/^\/docs\/?/, "");
  if (!withoutDocsPrefix) {
    // `/docs` itself is the Welcome page.
    return fs.existsSync(path.join(docsDir, "index.mdx"))
      ? path.join(docsDir, "index.mdx")
      : null;
  }

  const segments = withoutDocsPrefix.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  const candidateFiles = [
    path.join(docsDir, `${segments.join("/")}.mdx`),
    path.join(docsDir, segments.join("/"), "index.mdx"),
  ];

  return candidateFiles.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function extractInternalDocsLinks(source) {
  // Strip frontmatter and code fences before scanning so we don't
  // pick up example URLs from `<` snippets.
  const stripped = source
    .replace(/^---\r?\n[\s\S]*?\r?\n---/, "")
    .replace(/```[\s\S]*?```/g, "");

  const linkRegex = /\]\((\/docs\/[^)\s#?]*)([?#][^)]*)?\)/g;
  const links = [];
  let match;

  while ((match = linkRegex.exec(stripped)) !== null) {
    const url = match[1];
    const lineNumber = stripped.substring(0, match.index).split(/\r?\n/).length;
    links.push({ url, lineNumber });
  }

  return links;
}

const contentDirectories = [
  docsDir,
  path.join(docsDir, "changelog"),
  ...listDirectories(path.join(docsDir, "reference")),
];

for (const dir of contentDirectories) {
  const metaPath = path.join(dir, "meta.json");
  if (fs.existsSync(metaPath)) assertMetaPages(metaPath, dir);
}

const docsPageTreeSource = fs.readFileSync(docsPageTreePath, "utf8");

assert.match(
  docsPageTreeSource,
  /defaultOpen:\s*isChangelogFolder\s*\?\s*false/,
  "docs page tree must keep the changelog folder collapsed by default",
);
assert.match(
  docsPageTreeSource,
  /collapsible:\s*isChangelogFolder\s*\?\s*true/,
  "docs page tree must keep the changelog folder collapsible",
);

for (const filePath of collectAllMdxFiles(docsDir)) {
  const frontmatter = parseFrontmatter(filePath);

  assert.ok(frontmatter.title, `${filePath} must define a title`);
  assert.ok(
    frontmatter.description,
    `${filePath} must define a description for SEO and search`,
  );
  assert.equal(
    countMarkdownH1(filePath),
    1,
    `${filePath} must render exactly one markdown h1 because DocsPage does not inject one`,
  );

  const slug = fileRelativeSlug(filePath, docsDir);
  if (!CHANGELOG_RELEASE_PAGES.has(slug)) {
    const source = fs.readFileSync(filePath, "utf8");
    assert.ok(
      hasTailSection(source, ["Related", "Next steps"]),
      `${filePath} must end with a "## Related" or "## Next steps" section`,
    );
  }
}

for (const filePath of collectAllMdxFiles(docsDir)) {
  const source = fs.readFileSync(filePath, "utf8");
  for (const link of extractInternalDocsLinks(source)) {
    const resolved = resolveInternalLink(link.url);
    assert.ok(
      resolved,
      `${filePath}:${link.lineNumber} -> ${link.url} does not resolve to an MDX page under content/`,
    );
  }
}

const attentionAgentSource = fs.readFileSync(
  path.join(docsDir, "attention-agent.mdx"),
  "utf8",
);

assert.match(
  attentionAgentSource,
  /~\/\.openloomi\/pet-actions\.json/,
  "Attention Agent docs must describe the local prompt action config path",
);
assert.match(
  attentionAgentSource,
  /local prompt action shortcuts/,
  "Attention Agent docs must describe prompt actions as agent runtime shortcuts",
);
assert.match(
  attentionAgentSource,
  /Missing, empty, malformed, disabled, or unsupported configs render no prompt shortcuts/,
  "Attention Agent docs must document the invalid-config fallback",
);
assert.doesNotMatch(
  attentionAgentSource,
  /does not render arbitrary user-defined action lists|Pet menu stays fixed/,
  "Attention Agent docs must not claim prompt action menus are fixed or unsupported",
);

for (const fileName of fs
  .readdirSync(blogsDir)
  .filter((file) => file.endsWith(".md"))) {
  const filePath = path.join(blogsDir, fileName);
  const frontmatter = parseFrontmatter(filePath);

  assert.ok(frontmatter.title, `${fileName} must define a title`);
  assert.ok(frontmatter.description, `${fileName} must define a description`);
  assert.match(
    frontmatter.date ?? "",
    /^\d{4}-\d{2}-\d{2}$/,
    `${fileName} must define an ISO yyyy-mm-dd date`,
  );
}

console.log("Fumadocs content conventions passed.");
