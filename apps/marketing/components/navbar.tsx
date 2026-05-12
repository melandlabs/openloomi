"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { RemixIcon } from "@/components/remix-icon";
import { usePathname } from "next/navigation";
import { MobileDrawerMenu } from "./mobile-drawer-menu";
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

interface NavbarProps {
  links?: NavLink[];
  showAuthButtons?: boolean;
  onSignInClick?: () => void;
  onGetStartedClick?: () => void;
  topOffset?: string;
  backgroundVariant?: "background" | "surfaceBlue" | "backgroundCard";
  transparent?: boolean;
}

export function Navbar({
  links = [
    { name: "Home", href: "/" },
    { name: "Docs", href: "/docs" },
    { name: "Blogs", href: "/blogs" },
  ],
  showAuthButtons = false,
  onSignInClick,
  onGetStartedClick,
  topOffset = "0",
  backgroundVariant = "background",
  transparent = false,
}: NavbarProps = {}) {
  const { t } = useTranslation();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const pathname = usePathname();

  const isActive = (href?: string) => {
    if (!href) return false;
    return pathname === href || (href !== "/" && pathname.startsWith(href));
  };

  const handleLinkClick = (link: NavLink) => {
    if (link.onClick) {
      link.onClick();
    }
    setIsMenuOpen(false);
  };

  const handleSignInClick = () => {
    if (onSignInClick) {
      onSignInClick();
    } else {
      window.open("https://app.alloomi.ai", "_blank");
    }
  };

  const handleGetStartedClick = () => {
    if (onGetStartedClick) {
      onGetStartedClick();
    } else {
      window.open("https://app.alloomi.ai", "_blank");
    }
  };

  const getBgStyle = () => {
    if (transparent)
      return { backgroundColor: "transparent", borderBottom: "none" };
    if (backgroundVariant === "surfaceBlue")
      return { backgroundColor: "var(--color-surfaceBlue)" };
    if (backgroundVariant === "backgroundCard")
      return { backgroundColor: "var(--color-background-card)" };
    return { backgroundColor: "var(--color-background)" };
  };

  // Nav padding tuned to match the design preview.
  // Move: <md shows Logo.svg only; Desktop: shows Logo-full-light.
  return (
    <nav
      style={{
        position: "fixed",
        top: topOffset,
        left: 0,
        right: 0,
        zIndex: 30,
        padding: "24px 40px",
        transition: "all 0.3s",
        backdropFilter: transparent ? "none" : "blur(8px)",
        ...getBgStyle(),
      }}
    >
      <div
        style={{
          maxWidth: "1440px",
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {/* Logo */}
        <Link
          href="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
          }}
        >
          <Image
            // Desktop shows full logo; mobile uses monochrome logo for visibility.
            src="/img/Logo-full-light.svg"
            alt="Alloomi"
            className="hidden md:block h-5 w-auto object-contain"
            width={108}
            height={30}
            priority
          />
          <Image
            src="/img/Logo-full-light.svg"
            alt="Alloomi"
            className="block md:hidden h-5 w-auto object-contain"
            width={20}
            height={20}
            priority
          />
        </Link>

        {/* Desktop Navigation */}
        <div
          className="hidden md:flex"
          style={{ alignItems: "center", gap: "16px" }}
        >
          {links.map((link, index) => {
            const active = isActive(link.href);
            const linkStyle = {
              fontSize: "14px",
              fontWeight: active ? 500 : 400,
              transition: "color 0.15s",
              color: active
                ? "var(--color-foreground)"
                : "var(--color-foreground-muted)",
              textDecoration: "none",
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
                    style={linkStyle}
                  >
                    {link.name}
                  </a>
                );
              }
              return (
                <Link key={index} href={link.href} style={linkStyle}>
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
                    ...linkStyle,
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  {link.name}
                </button>
              );
            }
            return null;
          })}
        </div>

        {/* Desktop Auth Buttons */}
        {showAuthButtons && (
          <div
            className="hidden md:flex"
            style={{ alignItems: "center", gap: "12px" }}
          >
            <button
              type="button"
              onClick={handleSignInClick}
              style={{
                padding: "8px 16px",
                fontSize: "14px",
                fontWeight: 500,
                color: "var(--color-foreground-muted)",
                background: "none",
                border: "none",
                cursor: "pointer",
                transition: "color 0.15s",
              }}
            >
              {t("nav.signIn")}
            </button>
            <button
              type="button"
              onClick={handleGetStartedClick}
              style={{
                padding: "8px 16px",
                fontSize: "14px",
                fontWeight: 500,
                color: "var(--color-foreground-primary)",
                background:
                  "linear-gradient(180deg, var(--color-primary-start) 0%, var(--color-primary-end) 100%)",
                border: "none",
                borderRadius: "9999px",
                cursor: "pointer",
                transition: "transform 0.15s",
              }}
            >
              {t("nav.getStarted")}
            </button>
          </div>
        )}

        {/* Desktop Language Switcher */}
        {!showAuthButtons && (
          <div className="hidden md:flex" style={{ alignItems: "center" }}>
            <LanguageSwitch />
          </div>
        )}

        {/* Mobile Menu Button */}
        <div
          className="flex md:hidden"
          style={{ alignItems: "center", gap: "8px" }}
        >
          <LanguageSwitch />
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            style={{
              width: "48px",
              height: "48px",
              backgroundColor: "var(--color-background-card)",
              border: "1px solid var(--color-border-primary)",
              borderRadius: "12px",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
            }}
            aria-label="Toggle menu"
          >
            <RemixIcon name={isMenuOpen ? "close" : "menu"} size="size-5" />
          </button>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      <MobileDrawerMenu
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        links={links}
        showAuthButtons={showAuthButtons}
        onSignInClick={onSignInClick}
        onGetStartedClick={onGetStartedClick}
        isActive={isActive}
      />
    </nav>
  );
}
