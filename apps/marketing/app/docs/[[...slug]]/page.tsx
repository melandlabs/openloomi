import { notFound } from "next/navigation";
import { DocsBody, DocsPage } from "fumadocs-ui/layouts/docs/page";
import { getMDXComponents } from "@/mdx-components";
import { source } from "@/lib/source";

export function generateStaticParams() {
  return source.generateParams("slug");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const page = source.getPage(slug);

  if (!page) {
    notFound();
  }

  const title = page.data.title;
  const description = page.data.description ?? "OpenLoomi documentation";

  return {
    title,
    description,
    alternates: {
      canonical: `https://openloomi.ai${page.url}`,
    },
    openGraph: {
      title,
      description,
      url: `https://openloomi.ai${page.url}`,
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function Page({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const page = source.getPage(slug);

  if (!page) {
    notFound();
  }

  const MDX = page.data.body;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsBody>
        <MDX components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}
