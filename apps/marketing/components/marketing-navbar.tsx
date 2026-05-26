"use client";

import { useTranslation } from "react-i18next";
import { Navbar } from "@/components/navbar";

interface MarketingNavbarProps {
  backgroundVariant?: "background" | "surfaceBlue" | "backgroundCard";
  transparent?: boolean;
}

export function MarketingNavbar({
  backgroundVariant = "backgroundCard",
  transparent = false,
}: MarketingNavbarProps) {
  const { t } = useTranslation();

  return (
    <Navbar
      links={[
        { name: t("nav.home"), href: "/" },
        { name: t("nav.docs"), href: "/docs" },
        { name: t("nav.blogs"), href: "/blogs" },
      ]}
      showAuthButtons={false}
      topOffset="0"
      backgroundVariant={backgroundVariant}
      transparent={transparent}
    />
  );
}
