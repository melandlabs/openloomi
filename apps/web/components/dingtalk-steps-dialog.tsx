"use client";

import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@openloomi/ui";
import { isTauri, openUrl } from "@/lib/tauri";

const DINGTALK_DEV_URL =
  "https://open.dingtalk.com/document/orgapp/stream-mode-robot-overview";

type DingTalkStepsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * DingTalk Stream bot connection steps description
 */
export function DingTalkStepsDialog({
  open,
  onOpenChange,
}: DingTalkStepsDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[1010] sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t("auth.dingtalkStepsLink", "Setup steps")}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="text-sm text-muted-foreground space-y-4 pt-2">
              <section>
                <p className="font-medium text-foreground mb-2">
                  {t(
                    "auth.dingtalkStepsSection1Title",
                    "Create an app and enable a Stream bot",
                  )}
                </p>
                <ol className="list-decimal pl-4 space-y-1">
                  <li>
                    {t("auth.dingtalkSteps1Before", "Open ")}
                    {isTauri() ? (
                      <button
                        type="button"
                        onClick={() => openUrl(DINGTALK_DEV_URL)}
                        className="text-primary underline bg-transparent border-none cursor-pointer p-0"
                      >
                        {t(
                          "auth.dingtalkSteps1Link",
                          "DingTalk Open Platform · Stream bot",
                        )}
                      </button>
                    ) : (
                      <a
                        href={DINGTALK_DEV_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline"
                      >
                        {t(
                          "auth.dingtalkSteps1Link",
                          "DingTalk Open Platform · Stream bot",
                        )}
                      </a>
                    )}
                    {t(
                      "auth.dingtalkSteps1After",
                      " to create an enterprise app and get Client ID and Client Secret (i.e., AppKey / AppSecret)",
                    )}
                  </li>
                  <li>
                    {t(
                      "auth.dingtalkSteps2",
                      'In app capabilities, add "Bot" and select Stream mode (long connection for receiving messages)',
                    )}
                  </li>
                  <li>
                    {t(
                      "auth.dingtalkSteps3",
                      "After publishing the app, fill in Client ID and Client Secret in openloomi and connect",
                    )}
                  </li>
                  <li>
                    {t(
                      "auth.dingtalkSteps4",
                      "For web deployment, the server automatically starts Stream; for desktop, restart the app after connecting",
                    )}
                  </li>
                </ol>
              </section>
            </div>
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}
