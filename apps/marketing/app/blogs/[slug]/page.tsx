import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocsBody } from "fumadocs-ui/layouts/docs/page";
import { Footer } from "@/components/footer";
import { getMDXComponents } from "@/mdx-components";
import { MarketingNavbar } from "@/components/marketing-navbar";
import { blog } from "@/lib/source";

export function generateStaticParams() {
  return blog.getPages().map((page) => ({
    slug: page.slugs[0],
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = blog.getPage([slug]);

  if (!page) {
    return {
      title:
        "Article Not Found | OpenLoomi Knowledge Base | Calm Communication Guides | Inbox Intelligence Playbook | Productivity Systems Reference | Automation & Translation Tips",
      description:
        "The article you requested is unavailable. Browse the OpenLoomi blog for calm communication guides | inbox intelligence playbooks | productivity systems references | automation & translation tips | OpenLoomi product updates.",
      alternates: {
        canonical: `https://openloomi.ai/blogs/${slug}`,
      },
    };
  }

  const title = page.data.title;
  const description = page.data.description ?? `${title} from OpenLoomi`;
  const canonical = `https://openloomi.ai${page.url}`;
  const imageUrl = page.data.image
    ? new URL(page.data.image, "https://openloomi.ai").toString()
    : undefined;

  return {
    title,
    description,
    alternates: {
      canonical,
    },
    openGraph: {
      title,
      description,
      url: canonical,
      type: "article",
      publishedTime: new Date(page.data.date).toISOString(),
      images: imageUrl ? [imageUrl] : undefined,
    },
    twitter: {
      card: imageUrl ? "summary_large_image" : "summary",
      title,
      description,
      images: imageUrl ? [imageUrl] : undefined,
    },
  };
}

export default async function BlogPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = blog.getPage([slug]);

  if (!page) {
    notFound();
  }

  const MDX = page.data.body;
  const canonical = `https://openloomi.ai${page.url}`;
  const imageUrl = page.data.image
    ? new URL(page.data.image, "https://openloomi.ai").toString()
    : undefined;

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: page.data.title,
    description: page.data.description,
    image: imageUrl ? [imageUrl] : undefined,
    datePublished: new Date(page.data.date).toISOString(),
    dateModified: new Date(page.data.date).toISOString(),
    author: {
      "@type": "Organization",
      name: page.data.author,
      url: "https://openloomi.ai",
    },
    publisher: {
      "@type": "Organization",
      name: "OpenLoomi",
      logo: {
        "@type": "ImageObject",
        url: "https://openloomi.ai/images/logo_web.png",
      },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      <div className="flex min-h-screen flex-col bg-background-card">
        <MarketingNavbar backgroundVariant="backgroundCard" />
        <main className="flex-1">
          <article className="mx-auto max-w-[960px] px-4 py-8 pt-24 sm:px-6 lg:px-8">
            {page.data.image ? (
              <div className="relative mb-8 aspect-[16/7] overflow-hidden rounded-lg">
                <Image
                  src={page.data.image}
                  alt={page.data.title}
                  fill
                  className="object-cover"
                  priority
                  sizes="(max-width: 1024px) 100vw, 960px"
                />
              </div>
            ) : null}

            <h1 className="mb-3 text-3xl font-bold text-foreground md:text-4xl">
              {page.data.title}
            </h1>
            <p className="mb-8 text-foreground-muted">
              Published on{" "}
              {new Date(page.data.date).toLocaleDateString("en-US")}
            </p>

            <DocsBody>
              <MDX components={getMDXComponents()} />
            </DocsBody>

            <Link
              href="/blogs"
              className="mt-10 inline-flex text-brand hover:underline"
            >
              Back to all posts
            </Link>
          </article>
        </main>
        <Footer variant="default" />
      </div>
    </>
  );
}
