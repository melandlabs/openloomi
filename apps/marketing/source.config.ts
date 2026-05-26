import {
  defineCollections,
  defineConfig,
  defineDocs,
} from "fumadocs-mdx/config";
import { pageSchema } from "fumadocs-core/source/schema";
import { z } from "zod";

export const docs = defineDocs({
  dir: "content",
});

export const blogPosts = defineCollections({
  type: "doc",
  dir: "blogs",
  schema: pageSchema.extend({
    date: z.string().date().or(z.date()),
    image: z.string().optional(),
    author: z.string().default("OpenLoomi"),
  }),
});

export default defineConfig();
