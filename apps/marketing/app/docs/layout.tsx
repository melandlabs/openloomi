import { Footer } from "@/components/footer";
import { MarketingNavbar } from "@/components/marketing-navbar";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { getDocsPageTree } from "@/lib/docs-page-tree";
import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background-card">
      <MarketingNavbar backgroundVariant="backgroundCard" />
      <div className="openloomi-docs-shell pt-24">
        <DocsLayout
          tree={getDocsPageTree()}
          nav={{
            enabled: false,
          }}
          searchToggle={{
            enabled: false,
          }}
          sidebar={{
            enabled: true,
            defaultOpenLevel: 0,
            collapsible: false,
          }}
          themeSwitch={{
            enabled: false,
          }}
        >
          {children}
        </DocsLayout>
      </div>
      <Footer variant="default" />
    </div>
  );
}
