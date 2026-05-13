"use client";

import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@openloomi/ui";
import { isTauri, openUrl } from "@/lib/tauri";

const QQ_BOT_URL = "https://q.qq.com/qqbot/openclaw/";

interface QQBotStepsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * QQ Bot setup steps dialog: displays instructions for creating a bot, obtaining credentials, etc.
 */
export function QQBotStepsDialog({
  open,
  onOpenChange,
}: QQBotStepsDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[85vh] overflow-y-auto !z-[1020]"
        overlayClassName="!z-[1019]"
      >
        <DialogHeader>
          <DialogTitle>{t("auth.qqbotStepsLink", "Setup steps")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm text-foreground pb-4">
          <ol className="list-decimal list-inside space-y-2 pl-1">
            <li>
              {t("auth.qqbotSteps1Before", "Open ")}
              {isTauri() ? (
                <button
                  type="button"
                  onClick={() => openUrl(QQ_BOT_URL)}
                  className="text-primary underline bg-transparent border-none cursor-pointer p-0"
                >
                  {t("auth.qqbotSteps1Link", "QQ-BOT")}
                </button>
              ) : (
                <a
                  href={QQ_BOT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline"
                >
                  {t("auth.qqbotSteps1Link", "QQ-BOT")}
                </a>
              )}
              {t("auth.qqbotSteps1After", " and log in")}
            </li>
            <li>{t("auth.qqbotSteps2", 'Click "Create Bot"')}</li>
            <li>{t("auth.qqbotSteps3", "Get your App ID and App Secret")}</li>
            <li>
              {t(
                "auth.qqbotSteps4",
                'Fill in App ID and App Secret in the config, then click "Connect QQ"',
              )}
            </li>
          </ol>
        </div>
      </DialogContent>
    </Dialog>
  );
}
