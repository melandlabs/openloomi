"use client";

import Image from "next/image";
import React from "react";

/**
 * Gallery image item interface
 */
interface GalleryItem {
  /**
   * Image path
   */
  image: string;
  /**
   * Image title/description
   */
  title: string;
  /**
   * Image category (for optional filtering)
   */
  category?: string;
}

/**
 * Individual image card component
 */
function GalleryImageCard({ item }: { item: GalleryItem }) {
  return (
    <div
      className="bg-background-card border border-border-primary rounded-lg overflow-hidden transition-all duration-300 hover:shadow-lg hover:scale-[1.02] group"
      style={{ borderRadius: "var(--radius-card-medium)" }}
    >
      <div className="relative aspect-video overflow-hidden">
        <Image
          src={item.image}
          alt={item.title}
          fill
          sizes="(max-width: 768px) 50vw, 33vw"
          className="object-cover transition-transform duration-300 group-hover:scale-110"
        />
        {/* Overlay shown on hover */}
        <div className="absolute inset-0 bg-deepwater/0 group-hover:bg-deepwater/20 transition-all duration-300" />
      </div>
      <div className="p-4">
        <h3 className="text-foreground text-base font-medium">{item.title}</h3>
      </div>
    </div>
  );
}

/**
 * GallerySection component
 * Displays product screenshots and use case gallery
 * Mobile: grid layout, scrollable
 * Desktop: multi-column grid layout
 */
export default function GallerySection() {
  // Gallery image data - using existing Alloomi product screenshots
  const galleryItems: GalleryItem[] = [
    {
      image: "/img/alloomi/chat.png",
      title: "Smart Chat Interface",
      category: "chat",
    },
    {
      image: "/img/alloomi/chat-project.png",
      title: "Project Context Tracking",
      category: "chat",
    },
    {
      image: "/img/alloomi/insight-box.png",
      title: "Insight Cards",
      category: "insight",
    },
    {
      image: "/img/alloomi/agent-setting.png",
      title: "Agent Configuration",
      category: "settings",
    },
    {
      image: "/img/alloomi/agent-setting-people.png",
      title: "People Preferences",
      category: "settings",
    },
    {
      image: "/img/alloomi/agent-setting-topic.png",
      title: "Theme Preferences",
      category: "settings",
    },
    {
      image: "/img/alloomi/chat-history.png",
      title: "Chat History Management",
      category: "chat",
    },
    {
      image: "/img/alloomi/chat-report.png",
      title: "Smart Report Generation",
      category: "insight",
    },
    {
      image: "/img/alloomi/individual-plan.png",
      title: "Personal Plan Management",
      category: "planning",
    },
    {
      image: "/img/alloomi/business-plan.png",
      title: "Business Plan Tracking",
      category: "planning",
    },
    {
      image: "/img/alloomi/im-choose.png",
      title: "Multi-platform Integration",
      category: "platform",
    },
    {
      image: "/img/alloomi/chat-project-source-1.png",
      title: "Source Tracing",
      category: "chat",
    },
  ];

  const sectionWrapper =
    "w-full max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pt-3 pb-3 sm:pt-20 sm:pb-20 md:pt-16 md:pb-16";
  const sectionHeading =
    "text-2xl sm:text-3xl md:text-5xl w-full font-serif font-medium text-left mb-6";

  return (
    <section className={sectionWrapper}>
      <div className="w-full">
        <div className="mb-8 px-2">
          <h2 className={sectionHeading}>See Alloomi in Action</h2>
          <p className="text-foreground-muted text-lg">
            Explore Alloomi&apos;s core features and use cases
          </p>
        </div>

        {/* Mobile: 2-column grid */}
        <div className="grid grid-cols-2 gap-4 md:hidden">
          {galleryItems.map((item, index) => (
            <div key={index} className="w-full">
              <GalleryImageCard item={item} />
            </div>
          ))}
        </div>

        {/* Desktop: 3-column grid */}
        <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {galleryItems.map((item, index) => (
            <div key={index} className="w-full">
              <GalleryImageCard item={item} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
