import { Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import { getBlogList } from "@/lib/blogs";
import { BlogNav } from "@/components/ui/blog-nav";
import { BlogHeader } from "@/components/ui/blog-header";
import { Footer } from "@/components/footer";

/**
 * Navigation link config
 */

const blogIndexTitle = "Blogs";

const blogIndexDescription =
  "Explore the Alloomi AI blog for calm communication tactics | deep dives into AI inbox summaries | customer support automation stories | multilingual messaging best practices | productivity playbooks for distributed teams.";

export const metadata = {
  title: blogIndexTitle,
  description: blogIndexDescription,
  alternates: {
    canonical: "https://alloomi.ai/blogs",
  },
  openGraph: {
    title: blogIndexTitle,
    description: blogIndexDescription,
    url: "https://alloomi.ai/blogs",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: blogIndexTitle,
    description: blogIndexDescription,
  },
};

/**
 * Loading state component
 */
function Loading() {
  return <div className="text-center py-10">Loading content...</div>;
}

/**
 * Blog post card component
 */
function PostCard({ post }) {
  return (
    <Link href={`/blogs/${post.slug}`} className="text-inherit no-underline">
      <div className="border border-border-primary rounded-card overflow-hidden h-full flex flex-col transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
        {post.image && (
          <div className="w-full h-48 overflow-hidden">
            <Image
              src={post.image}
              alt={post.title}
              height={600}
              width={400}
              className="object-cover w-full h-full"
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            />
          </div>
        )}
        <div className="p-5 grow flex flex-col">
          <h2 className="text-xl font-semibold mb-2 text-foreground">
            {post.title}
          </h2>
          <p className="text-foreground-muted mb-3 grow">{post.description}</p>
          <p className="text-foreground-tertiary text-sm mt-auto">
            {new Date(post.date).toLocaleDateString("en-US")}
          </p>
        </div>
      </div>
    </Link>
  );
}

/**
 * Blog post grid component
 */
function PostsGrid({ posts }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
      {posts.map((post) => (
        <PostCard key={post.slug} post={post} />
      ))}
    </div>
  );
}

/**
 * Blog list page
 */
export default async function BlogPage() {
  const posts = await getBlogList();
  // Note: useTranslation cannot be used in async server components.
  // Navigation and page content are rendered without client-side translations here.
  // The language switch is handled client-side via the I18nProvider.
  return (
    <div className="min-h-screen bg-background-card flex flex-col">
      <BlogNav />
      <div className="flex-1">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-8 pt-24">
          <BlogHeader />

          <Suspense fallback={<Loading />}>
            <PostsGrid posts={posts} />
          </Suspense>
        </div>
      </div>
      <Footer variant="default" />
    </div>
  );
}
