"use client";

import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@openloomi/ui";
import { isTauri, openUrl } from "@/lib/tauri";

const FEISHU_OPEN_PLATFORM_URL = "https://open.feishu.cn/app";

interface FeishuStepsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Feishu connection steps dialog: displays instructions for creating apps, permissions, events, and publishing
 */
export function FeishuStepsDialog({
  open,
  onOpenChange,
}: FeishuStepsDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[85vh] overflow-y-auto !z-[1020]"
        overlayClassName="!z-[1019]"
      >
        <DialogHeader>
          <DialogTitle>{t("auth.feishuStepsLink", "Setup steps")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm text-foreground pb-4">
          <section>
            <h3 className="font-semibold mb-2">
              {t(
                "auth.feishuStepsSection1Title",
                "1. Create Lark/Feishu app and get credentials",
              )}
            </h3>
            <ol className="list-decimal list-inside space-y-2 pl-1">
              <li>
                {t("auth.feishuSteps1Before", "Open ")}
                {isTauri() ? (
                  <button
                    type="button"
                    onClick={() => openUrl(FEISHU_OPEN_PLATFORM_URL)}
                    className="text-primary underline bg-transparent border-none cursor-pointer p-0"
                  >
                    {t("auth.feishuSteps1Link", "Lark/Feishu Open Platform")}
                  </button>
                ) : (
                  <a
                    href={FEISHU_OPEN_PLATFORM_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline"
                  >
                    {t("auth.feishuSteps1Link", "Lark/Feishu Open Platform")}
                  </a>
                )}
                {t("auth.feishuSteps1After", " and create an enterprise app")}
              </li>
              <li>{t("auth.feishuSteps2")}</li>
              <li>{t("auth.feishuSteps3")}</li>
              <li>{t("auth.feishuSteps4")}</li>
              <li>{t("auth.feishuSteps5")}</li>
              <li>{t("auth.feishuSteps6")}</li>
            </ol>
            <pre className="my-2 bg-muted p-3 rounded-md text-xs overflow-x-auto whitespace-pre-wrap font-mono">
              {`{
  "scopes": {
    "tenant": [
      "aily:file:read",
      "aily:file:write",
      "application:application.app_message_stats.overview:readonly",
      "application:application:self_manage",
      "application:bot.menu:write",
      "cardkit:card:write",
      "contact:user.employee_id:readonly",
      "corehr:file:download",
      "docs:document.content:read",
      "event:ip_list",
      "im:chat",
      "im:chat.access_event.bot_p2p_chat:read",
      "im:chat.members:bot_access",
      "im:message",
      "im:message.group_at_msg:readonly",
      "im:message.group_msg",
      "im:message.p2p_msg:readonly",
      "im:message:readonly",
      "im:message:send_as_bot",
      "im:resource",
      "sheets:spreadsheet",
      "wiki:wiki:readonly"
    ],
    "user": [
      "aily:file:read",
      "aily:file:write",
      "im:chat.access_event.bot_p2p_chat:read",
      "im:chat:read",
      "im:chat:readonly"
    ]
  }
}`}
            </pre>
            <p className="text-muted-foreground text-xs mt-1">
              {t(
                "auth.feishuStepsNote",
                "Note: If the long connection is not shown here, try restarting openloomi",
              )}
            </p>
            <ol
              start={7}
              className="list-decimal list-inside space-y-2 pl-1 mt-2"
            >
              <li>{t("auth.feishuSteps7")}</li>
              <li>{t("auth.feishuSteps8")}</li>
              <li>{t("auth.feishuSteps9")}</li>
            </ol>
          </section>
          <section>
            <h3 className="font-semibold mb-2">
              {t(
                "auth.feishuStepsSection2Title",
                "2. Add the bot to your favorites",
              )}
            </h3>
            <ol className="list-decimal list-inside space-y-2 pl-1">
              <li>{t("auth.feishuStepsAddFav1")}</li>
              <li>{t("auth.feishuStepsAddFav2")}</li>
              <li>{t("auth.feishuStepsAddFav3")}</li>
            </ol>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
