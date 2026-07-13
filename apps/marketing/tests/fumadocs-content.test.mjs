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

for (const dir of contentDirectories) {
  for (const fileName of fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".mdx"))) {
    const filePath = path.join(dir, fileName);
    const frontmatter = parseFrontmatter(filePath);

    assert.ok(frontmatter.title, `${filePath} must define a title`);
    assert.equal(
      countMarkdownH1(filePath),
      1,
      `${filePath} must render exactly one markdown h1 because DocsPage does not inject one`,
    );
  }
}

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
