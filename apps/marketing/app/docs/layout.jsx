import { Layout } from "nextra-theme-docs";
import { getPageMap } from "nextra/page-map";
import "nextra-theme-docs/style.css";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";

/**
 * Navigation link config
 */
const navigationLinks = [
  { name: "Home", href: "/" },
  { name: "Pricing", href: "/pricing" },
  { name: "Docs", href: "/docs" },
  { name: "Blogs", href: "/blogs" },
];

/**
 * Docs layout component, integrates nextra theme
 * Provides ConfigContext to all docs routes
 */
async function DocsLayout({ children }) {
  const pageMap = await getPageMap();

  return (
    <div className="min-h-screen bg-background-card flex flex-col">
      <Navbar
        links={navigationLinks}
        showAuthButtons={false}
        topOffset="0"
        backgroundVariant="backgroundCard"
      />
      <div className="flex-1 pt-24">
        <Layout
          navbar={null}
          editLink={null}
          feedback={{ content: "", labels: "" }}
          sidebar={{
            defaultMenuCollapseLevel: 1,
          }}
          pageMap={pageMap}
          darkMode={false}
          nextThemes={{ forcedTheme: "light", defaultTheme: "light" }}
        >
          {children}
        </Layout>
      </div>
      <Footer variant="default" />
    </div>
  );
}

export default DocsLayout;
