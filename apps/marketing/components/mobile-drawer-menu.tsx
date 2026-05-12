"use client";

import { useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { RemixIcon } from "@/components/remix-icon";
import { AnimatePresence, motion } from "framer-motion";
import { LanguageSwitch } from "./language-switch";
import { useTranslation } from "react-i18next";

interface NavLink {
  name: string;
  href?: string;
  ref?: string;
  onClick?: () => void;
  download?: boolean;
  target?: string;
}

interface MobileDrawerMenuProps {
  isOpen: boolean;
  onClose: () => void;
  links: NavLink[];
  showAuthButtons?: boolean;
  onSignInClick?: () => void;
  onGetStartedClick?: () => void;
  isActive?: (href?: string) => boolean;
}

export function MobileDrawerMenu({
  isOpen,
  onClose,
  links,
  showAuthButtons = false,
  isActive,
}: MobileDrawerMenuProps) {
  const { t } = useTranslation();
  const handleLinkClick = (link: NavLink) => {
    if (link.onClick) {
      link.onClick();
    }
    onClose();
  };

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      const banner = document.querySelector(
        'section[aria-label="Alloomi Affiliate Program Promotion"]',
      );
      if (banner) {
        (banner as HTMLElement).style.display = "none";
        (banner as HTMLElement).style.visibility = "hidden";
      }
    } else {
      document.body.style.overflow = "";
      const banner = document.querySelector(
        'section[aria-label="Alloomi Affiliate Program Promotion"]',
      );
      if (banner) {
        (banner as HTMLElement).style.display = "";
        (banner as HTMLElement).style.visibility = "";
      }
    }
    return () => {
      document.body.style.overflow = "";
      const banner = document.querySelector(
        'section[aria-label="Alloomi Affiliate Program Promotion"]',
      );
      if (banner) {
        (banner as HTMLElement).style.display = "";
        (banner as HTMLElement).style.visibility = "";
      }
    };
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Background overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0,0,0,0.5)",
              backdropFilter: "blur(4px)",
              zIndex: 9998,
            }}
          />

          {/* Full screen menu */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "var(--color-background-card)",
              zIndex: 9999,
              display: "flex",
              flexDirection: "column",
              width: "100%",
              height: "100vh",
            }}
          >
            {/* Header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "16px 20px",
                borderBottom: "1px solid var(--color-border-primary)",
                flexShrink: 0,
              }}
            >
              <Link
                href="/"
                onClick={onClose}
                style={{ display: "flex", alignItems: "center" }}
              >
                <Image
                  src="/img/Logo-full-light.svg"
                  alt="Alloomi"
                  className="h-5 w-auto object-contain"
                  width={100}
                  height={20}
                />
              </Link>

              <div
                style={{ display: "flex", alignItems: "center", gap: "8px" }}
              >
                <LanguageSwitch />
                <button
                  onClick={onClose}
                  style={{
                    width: "48px",
                    height: "48px",
                    backgroundColor: "var(--color-background-secondary)",
                    border: "none",
                    borderRadius: "12px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                  }}
                  aria-label="Close menu"
                >
                  <RemixIcon name="close" size="size-5" />
                </button>
              </div>
            </div>

            {/* Navigation links */}
            <nav
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "24px 20px",
                backgroundColor: "var(--color-background-card)",
              }}
            >
              <div
                style={{ display: "flex", flexDirection: "column", gap: "8px" }}
              >
                {links.map((link, index) => {
                  const active = isActive?.(link.href) || false;
                  const baseStyle = {
                    display: "flex",
                    alignItems: "center",
                    minHeight: "56px",
                    padding: "12px 16px",
                    fontSize: "18px",
                    fontWeight: 500,
                    borderRadius: "12px",
                    transition: "all 0.15s",
                    cursor: "pointer" as const,
                  };

                  if (link.href) {
                    if (link.download || link.target) {
                      return (
                        <a
                          key={index}
                          href={link.href}
                          download={link.download}
                          target={link.target || "_blank"}
                          rel={link.target ? "noopener noreferrer" : undefined}
                          onClick={onClose}
                          style={{
                            ...baseStyle,
                            color: "var(--color-foreground)",
                            backgroundColor: active
                              ? "var(--color-background-secondary)"
                              : "transparent",
                            textDecoration: "none",
                          }}
                        >
                          {link.name}
                        </a>
                      );
                    }
                    return (
                      <Link
                        key={index}
                        href={link.href}
                        onClick={onClose}
                        style={{
                          ...baseStyle,
                          color: "var(--color-foreground)",
                          backgroundColor: active
                            ? "var(--color-background-secondary)"
                            : "transparent",
                        }}
                      >
                        {link.name}
                      </Link>
                    );
                  }
                  if (link.onClick) {
                    return (
                      <button
                        key={index}
                        onClick={() => handleLinkClick(link)}
                        style={{
                          ...baseStyle,
                          color: "var(--color-foreground)",
                          backgroundColor: "transparent",
                          textAlign: "left" as const,
                          border: "none",
                        }}
                      >
                        {link.name}
                      </button>
                    );
                  }
                  return null;
                })}
              </div>
            </nav>

            {/* Footer */}
            {showAuthButtons && (
              <div
                style={{
                  padding: "20px",
                  borderTop: "1px solid var(--color-border-primary)",
                  backgroundColor: "var(--color-background-card)",
                }}
              >
                <button
                  disabled
                  style={{
                    width: "100%",
                    padding: "16px",
                    fontSize: "18px",
                    fontWeight: 500,
                    color: "var(--color-foreground-muted)",
                    backgroundColor: "var(--color-muted)",
                    border: "1px solid var(--color-border-primary)",
                    borderRadius: "12px",
                    cursor: "not-allowed",
                  }}
                >
                  {t("footer.comingSoon")}
                </button>
                <button
                  disabled
                  style={{
                    width: "100%",
                    padding: "16px",
                    fontSize: "18px",
                    fontWeight: 500,
                    color: "var(--color-foreground-muted)",
                    backgroundColor: "var(--color-muted)",
                    border: "1px solid var(--color-border-primary)",
                    borderRadius: "12px",
                    cursor: "not-allowed",
                    marginTop: "12px",
                  }}
                >
                  {t("footer.comingSoon")}
                </button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
