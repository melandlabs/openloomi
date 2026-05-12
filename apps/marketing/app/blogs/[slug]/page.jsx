import { Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getBlogBySlug } from "@/lib/blogs";
import { Markdown } from "@/components/markdown";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";

/**
 * Loading state component
 */
function Loading() {
  return <div className="text-center py-10">Loading content...</div>;
}

/**
 * Blog post content component
 */
function PostContent({ post }) {
  return (
    <div className="min-h-screen bg-background-card flex flex-col">
      <Navbar
        links={[
          { name: "Home", href: "/" },
          { name: "Pricing", href: "/pricing" },
          { name: "Docs", href: "/docs" },
          { name: "Blogs", href: "/blogs" },
        ]}
        backgroundVariant="backgroundCard"
      />
      <div className="flex-1">
        <article className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-8 pt-24">
          {post.meta.image && (
            <div className="relative h-96 mb-8 rounded-lg overflow-hidden">
              <Image
                src={post.meta.image}
                alt={post.meta.title}
                fill
                className="object-cover"
                priority
              />
            </div>
          )}

          <h1 className="text-3xl font-bold mb-2 text-foreground">
            {post.meta.title}
          </h1>
          <p className="text-foreground-muted mb-8">
            Published on {new Date(post.meta.date).toLocaleDateString("en-US")}
          </p>

          <div className="prose prose-lg max-w-none">
            <Markdown>{post.content}</Markdown>
          </div>

          <div className="mt-10">
            <Link
              href="/blogs"
              className="text-brand hover:underline flex items-center"
            >
              ← Back to all posts
            </Link>
          </div>
        </article>
      </div>
      <Footer variant="default" />
    </div>
  );
}

/**
 * Generate page metadata
 */
export async function generateMetadata({ params }) {
  const resolvedParams = await params;
  const slug = resolvedParams?.slug;
  if (!slug) {
    return {
      title:
        "Alloomi AI Blog | Calm Communication Strategies | AI Inbox Insights | Customer Support Automation Playbook | Multilingual Messaging Tips | Productivity Systems for Remote Teams",
      description:
        "Discover Alloomi AI perspectives on calm communication | deep dives on inbox intelligence | automation guides for customer support | multilingual messaging best practices | productivity systems powering remote teams.",
    };
  }

  const post = await getBlogBySlug(slug);
  if (!post) {
    return {
      title:
        "Article Not Found | Alloomi AI Knowledge Base | Calm Communication Guides | Inbox Intelligence Playbook | Productivity Systems Reference | Automation & Translation Tips",
      description:
        "The article you requested is unavailable. Browse the Alloomi AI blog for calm communication guides | inbox intelligence playbooks | productivity systems references | automation & translation tips | Alloomi product updates.",
      alternates: {
        canonical: `https://alloomi.ai/blogs/${slug}`,
      },
    };
  }

  const baseTitle = post.meta.title || "Alloomi AI Blog";
  const slugWords = slug.replace(/-/g, " ");

  const titleSegments = [
    baseTitle,
    `${baseTitle} insights`,
    `${baseTitle} calm communication`,
    `${baseTitle} AI inbox summaries`,
    `${baseTitle} productivity playbook`,
  ];
  const pageTitle = Array.from(new Set(titleSegments)).join(" | ");

  const descriptionSegments = [
    post.meta.description || `${baseTitle} from Alloomi AI`,
    `${slugWords} calm communication`,
    "AI inbox summary best practices",
    "privacy-first customer support automation",
    "multilingual messaging intelligence tips",
  ];
  const pageDescription = descriptionSegments.join(" | ");

  const canonical = `https://alloomi.ai/blogs/${slug}`;
  const imageUrl = post.meta.image
    ? new URL(post.meta.image, "https://alloomi.ai").toString()
    : undefined;

  return {
    title: pageTitle,
    description: pageDescription,
    alternates: {
      canonical,
    },
    openGraph: {
      title: pageTitle,
      description: pageDescription,
      url: canonical,
      type: "article",
      publishedTime: post.meta.date,
      images: imageUrl ? [imageUrl] : undefined,
    },
    twitter: {
      card: imageUrl ? "summary_large_image" : "summary",
      title: pageTitle,
      description: pageDescription,
      images: imageUrl ? [imageUrl] : undefined,
    },
  };
}

/**
 * Blog post detail page
 */
export default async function BlogPage({ params }) {
  const resolvedParams = await params;
  const slug = resolvedParams?.slug;
  if (!slug) {
    notFound();
  }

  const post = await getBlogBySlug(slug);
  if (!post) {
    notFound();
  }

  const canonical = `https://alloomi.ai/blogs/${slug}`;
  const imageUrl = post.meta.image
    ? new URL(post.meta.image, "https://alloomi.ai").toString()
    : undefined;

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.meta.title,
    description: post.meta.description,
    image: imageUrl ? [imageUrl] : undefined,
    datePublished: post.meta.date,
    dateModified: post.meta.updatedAt || post.meta.date,
    author: {
      "@type": "Organization",
      name: "Alloomi",
      url: "https://alloomi.ai",
    },
    publisher: {
      "@type": "Organization",
      name: "Alloomi",
      logo: {
        "@type": "ImageObject",
        url: "https://alloomi.ai/images/logo_web.png",
      },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
  };

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: "https://alloomi.ai",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Blogs",
        item: "https://alloomi.ai/blogs",
      },
      {
        "@type": "ListItem",
        position: 3,
        name: post.meta.title,
        item: canonical,
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <Suspense fallback={<Loading />}>
        <PostContent post={post} />
      </Suspense>
    </>
  );
}
