"use client";
import { Button, Card, CardContent } from "@openloomi/ui";
import { RemixIcon } from "@/components/remix-icon";
import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import { isTauri, openUrl } from "@/lib/tauri";

export function IntegrationAuthCard({ showTitle }: { showTitle: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <Card className="w-full max-w-lg bg-white border border-gray-200 rounded-lg shadow-sm mx-auto">
      <CardContent className="p-4 sm:p-6">
        {showTitle && (
          <p className="text-sm font-medium text-[#37352f] leading-relaxed whitespace-pre-wrap">
            {t("common.unAuth")}
          </p>
        )}
        <div className="mt-4 space-y-5">
          <div className="flex flex-col gap-2">
            <Button
              onClick={() => router.push("/?page=profile")}
              variant="default"
              className="w-full justify-center gap-2"
            >
              <RemixIcon name="user" size="size-4" />
              <span>{t("common.myIntegrations")}</span>
            </Button>
          </div>

          <div className="rounded-xl bg-[#f7f6f3] p-3 text-xs text-[#6f6e69]">
            <p className="font-medium text-[#37352f]">
              {t("common.supportedPlatforms")}
            </p>
            <p className="mt-1">Microsoft Teams</p>
          </div>

          <div className="rounded-xl border border-[#e5e5e5] p-3 text-xs text-[#6f6e69] space-y-2">
            <p className="font-medium text-[#37352f]">
              {t("auth.securityAndInfo")}
            </p>
            <ul className="list-disc space-y-1 pl-4">
              <li>{t("securityPrompt.principles.leastAccessDesc")}</li>
              <li>{t("securityPrompt.principles.encryptedStorageDesc")}</li>
              <li>{t("auth.infoItem3")}</li>
            </ul>
            <p>
              {t("auth.infoItem4")}
              {isTauri() ? (
                <>
                  <button
                    type="button"
                    onClick={() => openUrl("https://app.openloomi.ai/privacy")}
                    className="text-blue-500 hover:underline bg-transparent border-none cursor-pointer p-0"
                  >
                    {t("auth.privacy")}
                  </button>
                  {t("auth.and")}
                  <button
                    type="button"
                    onClick={() => openUrl("https://app.openloomi.ai/terms")}
                    className="text-blue-500 hover:underline bg-transparent border-none cursor-pointer p-0"
                  >
                    {t("auth.tos")}
                  </button>
                </>
              ) : (
                <>
                  <a
                    href="/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:underline"
                  >
                    {t("auth.privacy")}
                  </a>
                  {t("auth.and")}
                  <a
                    href="/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:underline"
                  >
                    {t("auth.tos")}
                  </a>
                </>
              )}
              {t("auth.end")}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
