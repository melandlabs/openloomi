import Image from "next/image";
import Link from "next/link";
import { MarketingNavbar } from "@/components/marketing-navbar";
import { Footer } from "@/components/footer";
import { blog } from "@/lib/source";

const blogIndexTitle = "Blog";

const blogIndexDescription =
  "Explore the OpenLoomi blog for calm communication tactics | deep dives into AI inbox summaries | customer support automation stories | multilingual messaging best practices | productivity playbooks for distributed teams.";

export const metadata = {
  title: blogIndexTitle,
  description: blogIndexDescription,
  alternates: {
    canonical: "https://openloomi.ai/blogs",
  },
  openGraph: {
    title: blogIndexTitle,
    description: blogIndexDescription,
    url: "https://openloomi.ai/blogs",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: blogIndexTitle,
    description: blogIndexDescription,
  },
};

const postDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function formatPostDate(date: string | Date) {
  return postDateFormatter.format(new Date(date));
}

function BlogHero({ postCount }: { postCount: number }) {
  return (
    <header className="border-b border-border-primary pb-10 pt-4 sm:pb-12 lg:pb-14">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-accent-700">
            OpenLoomi Journal
          </p>
          <h1 className="text-balance text-5xl font-semibold leading-[0.98] text-foreground sm:text-6xl lg:text-7xl">
            Signals for calmer, higher-leverage work.
          </h1>
        </div>
        <div className="max-w-xl lg:pb-2">
          <p className="text-pretty text-lg leading-8 text-foreground-muted">
            Product thinking, AI-native workflows, communication systems, and
            the operating principles behind OpenLoomi.
          </p>
          <p className="mt-5 text-sm font-medium text-foreground-secondary">
            {postCount} essays and product notes
          </p>
        </div>
      </div>
    </header>
  );
}

function PostCard({
  post,
  featured = false,
}: {
  post: ReturnType<typeof blog.getPages>[number];
  featured?: boolean;
}) {
  const publishedDate = formatPostDate(post.data.date);

  return (
    <Link
      href={post.url}
      className={[
        "group block h-full rounded-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-300",
        featured ? "lg:col-span-2" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <article className="flex h-full flex-col overflow-hidden rounded-card border border-border-primary bg-background-card shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-1 hover:border-primary-200 hover:shadow-[0_18px_50px_rgba(19,64,143,0.12)]">
        {post.data.image ? (
          <div
            className={[
              "relative w-full overflow-hidden bg-[#071225]",
              featured ? "aspect-[16/7]" : "aspect-[16/10]",
            ].join(" ")}
          >
            <Image
              src={post.data.image}
              alt={post.data.title}
              fill
              className="object-contain transition-transform duration-500 group-hover:scale-[1.035]"
              sizes={
                featured
                  ? "(max-width: 1024px) 100vw, 880px"
                  : "(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 420px"
              }
            />
            <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/35 to-transparent" />
            <p className="absolute bottom-4 left-4 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-primary-800 shadow-sm backdrop-blur">
              {publishedDate}
            </p>
          </div>
        ) : null}
        <div
          className={[
            "flex grow flex-col",
            featured ? "p-6 sm:p-7" : "p-5 sm:p-6",
          ].join(" ")}
        >
          <div className="mb-4 flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-[0.14em] text-accent-700">
            <span>Insight</span>
            {!post.data.image ? <span>{publishedDate}</span> : null}
          </div>
          <h2
            className={[
              "text-pretty font-semibold leading-tight text-foreground transition-colors group-hover:text-primary-700",
              featured
                ? "text-2xl sm:text-3xl lg:text-4xl"
                : "text-xl sm:text-2xl",
            ].join(" ")}
          >
            {post.data.title}
          </h2>
          <p className="mt-4 line-clamp-3 grow text-base leading-7 text-foreground-muted">
            {post.data.description}
          </p>
          <p className="mt-6 inline-flex items-center text-sm font-semibold text-primary-700">
            Read Article
            <span
              className="ml-2 transition-transform duration-200 group-hover:translate-x-1"
              aria-hidden="true"
            >
              -&gt;
            </span>
          </p>
        </div>
      </article>
    </Link>
  );
}

export default function BlogPage() {
  const posts = [...blog.getPages()].sort(
    (a, b) => +new Date(b.data.date) - +new Date(a.data.date),
  );

  return (
    <div className="flex min-h-screen flex-col bg-background-card">
      <MarketingNavbar backgroundVariant="backgroundCard" />
      <main className="flex-1">
        <div className="mx-auto max-w-[1440px] px-4 pb-16 pt-24 sm:px-6 sm:pb-20 lg:px-8">
          <BlogHero postCount={posts.length} />
          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-7">
            {posts.map((post, index) => (
              <PostCard key={post.url} post={post} featured={index === 0} />
            ))}
          </div>
        </div>
      </main>
      <Footer variant="default" />
    </div>
  );
}
