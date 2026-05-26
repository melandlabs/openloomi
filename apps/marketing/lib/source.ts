import { loader } from "fumadocs-core/source";
import { toFumadocsSource } from "fumadocs-mdx/runtime/server";
import { blogPosts, docs } from "collections/server";

export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
});

export const blog = loader({
  baseUrl: "/blogs",
  source: toFumadocsSource(blogPosts, []),
});
