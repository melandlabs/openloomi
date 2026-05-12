"use client";

import { useTranslation } from "react-i18next";
import { SectionEyebrow } from "@/components/section-eyebrow";

/**
 * User testimonial data interface
 */
interface Testimonial {
  name: string;
  role: string;
  content: string;
}

/**
 * Testimonial card component
 * Unified card style for mobile and desktop
 * Card height expands with content, avoids clipping
 */
function TestimonialCard({ testimonial }: { testimonial: Testimonial }) {
  return (
    <div className="bg-flowlight rounded-2xl p-8 flex flex-col border border-border-primary transition-colors">
      <div className="mb-4">
        <i className="ri-double-quotes-l size-8 text-flowlight" />
      </div>
      <ScrollingText text={testimonial.content} />
      <div className="mt-4 flex flex-col">
        <div className="text-foreground text-base font-medium">
          {testimonial.name}
        </div>
        <span className="text-foreground-muted text-sm">
          {testimonial.role}
        </span>
      </div>
    </div>
  );
}

/**
 * Testimonial text display component
 * Static text display with auto-wrap based on card width, avoids inner scrolling
 */
function ScrollingText({ text }: { text: string }) {
  return (
    <div className="w-full text-foreground-muted whitespace-normal break-words font-serif">
      {text}
    </div>
  );
}

/**
 * TestimonialSection component
 * Displays user testimonials and trust content section
 * Desktop: single-row cards, horizontal auto-scroll, card width 400px, height varies with content
 * Mobile: 1 card per row, vertical scroll within fixed height
 */
export default function TestimonialSection() {
  const { t } = useTranslation();
  const testimonials = t("testimonials.items", {
    returnObjects: true,
  }) as Testimonial[];

  /**
   * Function: TestimonialSection
   * - Keep this padding config aligned with the browser preview specs.
   */
  const sectionWrapper =
    "w-full max-w-[1440px] mx-auto bg-primary-50 px-4 sm:px-6 lg:px-20 pt-3 pb-3 sm:pt-20 sm:pb-20 md:pt-32 md:pb-32";
  const sectionHeading =
    "text-2xl sm:text-3xl md:text-5xl w-full font-serif font-semibold text-center mb-6";
  /**
   * Function: getHeadingToCardsGapValue
   * - Centralize heading-to-cards spacing for all breakpoints.
   */
  const getHeadingToCardsGapValue = () => "24px";

  return (
    <section className={sectionWrapper}>
      <div className="w-full">
        <div className="flex flex-col justify-start items-center gap-6">
          {/* Badge above heading to match the browser preview hierarchy */}
          <SectionEyebrow variant="pill">
            {t("testimonials.eyebrow")}
          </SectionEyebrow>
          <h2 className={sectionHeading}>{t("testimonials.title")}</h2>
        </div>
        <div
          aria-hidden="true"
          style={{ height: getHeadingToCardsGapValue() }}
        />

        {/* Mobile: 1 per row, vertical scroll within fixed height */}
        <div className="md:hidden overflow-hidden" style={{ height: "1200px" }}>
          <div className="animate-scroll-vertical">
            {[...testimonials, ...testimonials].map((testimonial, index) => (
              <div key={index} className="mb-4">
                <TestimonialCard testimonial={testimonial} />
              </div>
            ))}
          </div>
        </div>

        {/* Desktop: single-row cards, horizontal auto-scroll */}
        {/* Use negative margin to break container padding, align content to screen edge */}
        <div
          className="hidden md:block"
          style={{
            marginLeft: "calc(-1 * (100vw - 100%) / 2)",
            marginRight: "calc(-1 * (100vw - 100%) / 2)",
            width: "100vw",
          }}
        >
          <div className="overflow-hidden">
            <div
              className="animate-scroll-horizontal"
              style={{ display: "flex", gap: "1rem", width: "max-content" }}
            >
              {/* Group 1 */}
              <div
                style={{
                  display: "flex",
                  gap: "1.5rem",
                  flexWrap: "nowrap",
                  flexShrink: 0,
                }}
              >
                {testimonials.map((testimonial, index) => (
                  <div
                    key={`single-row-${index}`}
                    style={{ width: "360px", flexShrink: 0 }}
                  >
                    <TestimonialCard testimonial={testimonial} />
                  </div>
                ))}
              </div>
              {/* Group 2: duplicated for seamless scroll */}
              <div
                style={{
                  display: "flex",
                  gap: "1.5rem",
                  flexWrap: "nowrap",
                  flexShrink: 0,
                }}
              >
                {testimonials.map((testimonial, index) => (
                  <div
                    key={`single-row-dup-${index}`}
                    style={{ width: "360px", flexShrink: 0 }}
                  >
                    <TestimonialCard testimonial={testimonial} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
