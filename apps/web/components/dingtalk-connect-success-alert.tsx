"use client";

import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@openloomi/ui";
import { isTauri } from "@/lib/tauri";

type DingTalkConnectSuccessAlertProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

/**
 * Notification after successful DingTalk integration: desktop requires app restart, web suggests refresh.
 */
export function DingTalkConnectSuccessAlert({
  open,
  onOpenChange,
  onConfirm,
}: DingTalkConnectSuccessAlertProps) {
  const { t } = useTranslation();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="z-[1100]" overlayClassName="z-[1099]">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(
              "auth.dingtalkConnectRestartTitle",
              "DingTalk connection successful",
            )}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isTauri()
              ? t(
                  "auth.dingtalkConnectRestartDescTauri",
                  "To ensure stable DingTalk message listening, please fully quit and restart the openloomi desktop client",
                )
              : t(
                  "auth.dingtalkConnectRestartDescWeb",
                  "Please refresh the current page to ensure DingTalk listening and integration status are fully active",
                )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={() => onConfirm()}>
            {t("auth.dingtalkConnectRestartConfirm", "Got it")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
