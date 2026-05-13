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

type FeishuConnectSuccessAlertProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after user confirmation (navigation, close parent modal, etc.) */
  onConfirm: () => void;
};

/**
 * Notification after successful Feishu integration: desktop requires app restart, web suggests refresh.
 */
export function FeishuConnectSuccessAlert({
  open,
  onOpenChange,
  onConfirm,
}: FeishuConnectSuccessAlertProps) {
  const { t } = useTranslation();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="z-[1100]" overlayClassName="z-[1099]">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(
              "auth.feishuConnectRestartTitle",
              "Lark/Feishu connection successful",
            )}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isTauri()
              ? t(
                  "auth.feishuConnectRestartDescTauri",
                  "To ensure stable Lark/Feishu message listening, please fully quit and restart the openloomi desktop client",
                )
              : t(
                  "auth.feishuConnectRestartDescWeb",
                  "Please refresh the current page to ensure Lark/Feishu listening and integration status are fully active",
                )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction
            onClick={() => {
              onConfirm();
            }}
          >
            {t("auth.feishuConnectRestartConfirm", "Got it")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
