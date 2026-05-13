"use client";

import { useCallback, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@openloomi/ui";
import { Button, Input, Label } from "@openloomi/ui";
import { toast } from "@/components/toast";
import { RemixIcon } from "@/components/remix-icon";

export type MessengerAuthSubmission = {
  pageId: string;
  pageAccessToken: string;
  pageName?: string;
  appId?: string;
  appSecret?: string;
  verifyToken?: string;
};

interface MessengerAuthFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: MessengerAuthSubmission) => Promise<void>;
  embedded?: boolean;
}

export function MessengerAuthForm({
  isOpen,
  onClose,
  onSubmit,
  embedded = false,
}: MessengerAuthFormProps) {
  const { t } = useTranslation();
  const [pageId, setPageId] = useState("");
  const [pageAccessToken, setPageAccessToken] = useState("");
  const [pageName, setPageName] = useState("");
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [verifyToken, setVerifyToken] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setPageId("");
    setPageAccessToken("");
    setPageName("");
    setAppId("");
    setAppSecret("");
    setVerifyToken("");
    setError(null);
    setIsSubmitting(false);
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);

      if (!pageId.trim() || !pageAccessToken.trim()) {
        setError(t("auth.messengerMissingToken"));
        return;
      }

      setIsSubmitting(true);
      try {
        await onSubmit({
          pageId: pageId.trim(),
          pageAccessToken: pageAccessToken.trim(),
          pageName: pageName.trim() || undefined,
          appId: appId.trim() || undefined,
          appSecret: appSecret.trim() || undefined,
          verifyToken: verifyToken.trim() || undefined,
        });
        toast({
          type: "success",
          description: t(
            "auth.messengerSuccess",
            "Messenger account connected successfully!",
          ),
        });
        resetForm();
        onClose();
      } catch (submitError) {
        const message =
          submitError instanceof Error
            ? submitError.message
            : t("common.operationFailed");
        toast({ type: "error", description: message });
        setError(message);
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      appId,
      appSecret,
      onClose,
      onSubmit,
      pageAccessToken,
      pageId,
      pageName,
      t,
      verifyToken,
      resetForm,
    ],
  );

  const formBody = (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <Label htmlFor="messenger-page-id">
          {t("auth.messengerPageId", "Page ID")}
        </Label>
        <Input
          id="messenger-page-id"
          value={pageId}
          onChange={(e) => setPageId(e.target.value)}
          placeholder={t("auth.messengerPageIdPlaceholder")}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="messenger-page-token">
          {t("auth.messengerPageAccessToken", "Page access token")}
        </Label>
        <Input
          id="messenger-page-token"
          value={pageAccessToken}
          onChange={(e) => setPageAccessToken(e.target.value)}
          placeholder={t("auth.messengerPageAccessTokenPlaceholder")}
          required
          type="password"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="messenger-page-name">
            {t("auth.messengerPageName", "Display name (optional)")}
          </Label>
          <Input
            id="messenger-page-name"
            value={pageName}
            onChange={(e) => setPageName(e.target.value)}
            placeholder="openloomi Page"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="messenger-verify-token">
            {t("auth.messengerVerifyToken", "Webhook verify token")}
          </Label>
          <Input
            id="messenger-verify-token"
            value={verifyToken}
            onChange={(e) => setVerifyToken(e.target.value)}
            placeholder="optional"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="messenger-app-id">
            {t("auth.messengerAppId", "App ID")}
          </Label>
          <Input
            id="messenger-app-id"
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            placeholder="optional"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="messenger-app-secret">
            {t("auth.messengerAppSecret", "App secret")}
          </Label>
          <Input
            id="messenger-app-secret"
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
            placeholder="optional"
            type="password"
          />
        </div>
      </div>

      {error ? (
        <p className="text-sm text-red-500" role="alert">
          {error}
        </p>
      ) : null}

      <DialogFooter className="flex items-center justify-between space-x-2">
        {!embedded && (
          <Button
            type="button"
            variant="outline"
            onClick={() => onClose()}
            disabled={isSubmitting}
          >
            {t("common.cancel")}
          </Button>
        )}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <RemixIcon
                name="loader_2"
                size="size-4"
                className="mr-2 animate-spin"
              />
              {t("common.processing")}
            </>
          ) : (
            t("auth.messengerSubmit", "Save and connect")
          )}
        </Button>
      </DialogFooter>
    </form>
  );

  if (embedded) {
    return (
      <>
        <p className="text-sm text-muted-foreground mb-2">
          {t(
            "auth.messengerConnectDescription",
            "Use a Facebook Page access token with messaging permissions.",
          )}
        </p>
        {formBody}
      </>
    );
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          resetForm();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("auth.messengerConnectTitle")}</DialogTitle>
          <DialogDescription>
            {t(
              "auth.messengerConnectDescription",
              "Use a Facebook Page access token with messaging permissions.",
            )}
          </DialogDescription>
        </DialogHeader>
        {formBody}
      </DialogContent>
    </Dialog>
  );
}
