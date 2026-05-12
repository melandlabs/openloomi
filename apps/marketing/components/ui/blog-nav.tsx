"use client";

import { Navbar } from "@/components/navbar";
import { useTranslation } from "react-i18next";

export function BlogNav() {
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
      backgroundVariant="backgroundCard"
    />
  );
}
