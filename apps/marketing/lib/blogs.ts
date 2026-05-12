"use server";

import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

/**
 * Blog post metadata interface
 */
export interface PostMeta {
  title: string;
  date: string;
  description: string;
  image?: string;
}

/**
 * Blog post interface
 */
export interface Post {
  slug: string;
  content: string;
  meta: PostMeta;
}

const postsDirectory = path.join(process.cwd(), "blogs");

/**
 * Get all blog posts
 * @returns Blog posts list with slug and metadata
 */
export async function getBlogList(): Promise<
  Array<{ slug: string } & PostMeta>
> {
  if (!fs.existsSync(postsDirectory)) return [];

  const fileNames = fs.readdirSync(postsDirectory);

  // Use synchronous operations directly instead of wrapping in Promise.all
  const posts = fileNames.map((fileName) => {
    const slug = fileName.replace(/\.md$/, "");
    const fullPath = path.join(postsDirectory, fileName);
    const fileContents = fs.readFileSync(fullPath, "utf8");
    const { data } = matter(fileContents);

    return {
      slug,
      title: data.title || "Untitled",
      date: data.date || new Date().toISOString(),
      description: data.description || "",
      image: data.image,
    };
  });

  // Sort by date descending
  return posts.sort((a, b) => +new Date(b.date) - +new Date(a.date));
}

/**
 * Get a single blog post by slug
 * @param slug - Article slug
 * @returns Blog post or null
 */
export async function getBlogBySlug(slug: string): Promise<Post | null> {
  const fullPath = path.join(postsDirectory, `${slug}.md`);
  if (!fs.existsSync(fullPath)) return null;

  const fileContents = fs.readFileSync(fullPath, "utf8");
  const { data, content } = matter(fileContents);

  return {
    slug,
    content,
    meta: {
      title: data.title || "Untitled",
      date: data.date || new Date().toISOString(),
      description: data.description || "",
      image: data.image,
    },
  };
}
