"use client";

import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@openloomi/ui";

interface WeixinStepsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * WeChat integration instructions: QR code displayed automatically in page, using server-side default iLink config
 */
export function WeixinStepsDialog({
  open,
  onOpenChange,
}: WeixinStepsDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[85vh] overflow-y-auto !z-[1020]"
        overlayClassName="!z-[1019]"
      >
        <DialogHeader>
          <DialogTitle>{t("auth.weixinStepsTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm text-foreground pb-4">
          <p>{t("auth.weixinStepsIntroV3")}</p>
          <ol className="list-decimal list-inside space-y-2 pl-1">
            <li>{t("auth.weixinSteps1V2")}</li>
            <li>{t("auth.weixinSteps2V2")}</li>
            <li>{t("auth.weixinSteps3")}</li>
          </ol>
          <p className="text-xs text-muted-foreground">
            {t("auth.weixinStepsFaq")}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
