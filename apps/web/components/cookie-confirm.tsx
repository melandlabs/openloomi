"use client";

import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import { setCookiePreference } from "@/app/(chat)/actions";

interface CookieConfirmProps {
  userCookieConfirm?: string;
}

export default function CookieConfirm({
  userCookieConfirm,
}: CookieConfirmProps) {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!userCookieConfirm) {
      // Delay show to let page finish loading
      const timer = setTimeout(() => {
        setIsVisible(true);
      }, 1500);
      return () => clearTimeout(timer);
    }
    if (userCookieConfirm) {
      setIsVisible(false);
    }
  }, [userCookieConfirm]);

  const handleAccept = async () => {
    await setCookiePreference("1");
    setIsVisible(false);
  };

  const handleDecline = async () => {
    await setCookiePreference("0");
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-[60] bg-white border-t border-[#e5e5e5] shadow-lg max-h-[80vh] overflow-y-auto">
      <div className="max-w-7xl mx-auto p-4 sm:px-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex-1 min-w-0 w-full sm:w-auto">
            <h3 className="text-sm font-semibold text-[#37352f] mb-1">
              {t("cookie.title")}
            </h3>
            <p className="text-xs text-[#6f6e69] leading-relaxed sm:leading-normal">
              {t("cookie.description")}
            </p>
          </div>

          <div className="flex items-center justify-center gap-3 shrink-0 w-full sm:w-auto mt-2 sm:mt-0">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDecline}
              className="border-[#e5e5e5] hover:bg-[#f7f6f3] text-xs px-5 py-2"
            >
              {t("cookie.onlyNecessary")}
            </Button>

            <Button
              data-testid="btn-accept-cookie"
              size="sm"
              onClick={handleAccept}
              className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white text-xs px-5 py-2"
            >
              <RemixIcon name="shield" size="size-3" className="mr-1" />
              {t("cookie.acceptAll")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
