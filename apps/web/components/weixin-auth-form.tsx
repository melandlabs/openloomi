"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@openloomi/ui";
import { Button, Input, Label } from "@openloomi/ui";
import { Spinner } from "@/components/spinner";
import { toast } from "@/components/toast";
import { WeixinStepsDialog } from "@/components/weixin-steps-dialog";
import { getAuthToken } from "@/lib/auth/token-manager";
import { getHomePath } from "@/lib/utils";
import { QRCodeSVG } from "qrcode.react";

type AuthStatus = "idle" | "connecting" | "completed" | "error";

type QrPhase = "idle" | "waiting" | "scanned" | "expired";

interface WeixinAuthFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  /** When true, renders form content inline without the Dialog wrapper */
  embedded?: boolean;
}

/** Determines if the string is a direct image URL usable as <img src> (otherwise encode as text using QRCodeSVG) */
function shouldRenderQrAsImage(s: string): boolean {
  const t = s.trim();
  if (/^data:image\//i.test(t)) return true;
  return /^https?:\/\//i.test(t) && /\.(png|jpe?g|gif|webp)(\?|$)/i.test(t);
}

/**
 * WeChat iLink: fetches QR code and polls login status immediately when dialog opens (server default API base URL and routes)
 */
export function WeixinAuthForm({
  isOpen,
  onClose,
  onSuccess,
  embedded = false,
}: WeixinAuthFormProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [status, setStatus] = useState<AuthStatus>("idle");
  const [displayName, setDisplayName] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [stepsOpen, setStepsOpen] = useState(false);

  const [qrContent, setQrContent] = useState<string | null>(null);
  const [qrPhase, setQrPhase] = useState<QrPhase>("idle");
  const pollAbortRef = useRef<AbortController | null>(null);
  const loginIdRef = useRef<string | null>(null);
  const displayNameRef = useRef("");
  const qrFlowGenerationRef = useRef(0);
  const handleCloseRef = useRef<() => void>(() => {});
  const onSuccessRef = useRef(onSuccess);

  useEffect(() => {
    displayNameRef.current = displayName;
  }, [displayName]);

  const resetState = useCallback(() => {
    setStatus("idle");
    setDisplayName("");
    setErrorMessage(null);
    setQrContent(null);
    setQrPhase("idle");
    loginIdRef.current = null;
  }, []);

  const cancelQrSession = useCallback(async (id: string | null) => {
    if (!id) return;
    try {
      await fetch("/api/weixin/qr/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ loginId: id }),
      });
    } catch {
      // Ignore
    }
  }, []);

  const handleClose = useCallback(() => {
    qrFlowGenerationRef.current += 1;
    pollAbortRef.current?.abort();
    void cancelQrSession(loginIdRef.current);
    resetState();
    onClose();
  }, [status, resetState, onClose, cancelQrSession]);

  useEffect(() => {
    handleCloseRef.current = handleClose;
  }, [handleClose]);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        handleClose();
      }
    },
    [handleClose],
  );

  const startQrFlow = useCallback(async () => {
    const myGeneration = ++qrFlowGenerationRef.current;

    pollAbortRef.current?.abort();
    const prevLogin = loginIdRef.current;
    loginIdRef.current = null;
    if (prevLogin) {
      await cancelQrSession(prevLogin);
    }

    if (myGeneration !== qrFlowGenerationRef.current) return;

    setStatus("connecting");
    setErrorMessage(null);
    setQrPhase("waiting");
    setQrContent(null);

    try {
      const startRes = await fetch("/api/weixin/qr/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      const startJson = (await startRes.json()) as {
        loginId?: string;
        qrContent?: string;
        error?: string;
      };

      if (myGeneration !== qrFlowGenerationRef.current) {
        if (startJson.loginId) await cancelQrSession(startJson.loginId);
        return;
      }

      if (!startRes.ok || !startJson.loginId || !startJson.qrContent) {
        throw new Error(startJson.error ?? t("auth.weixinErrorNoQr"));
      }
      loginIdRef.current = startJson.loginId;
      setQrContent(startJson.qrContent);

      pollAbortRef.current?.abort();
      const ac = new AbortController();
      pollAbortRef.current = ac;

      // Long polling: each request lasts up to ~12s (adjustable via WEIXIN_QR_LONG_POLL_MS), loops until success or failure
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (myGeneration !== qrFlowGenerationRef.current) return;
        if (ac.signal.aborted) return;

        const pollRes = await fetch("/api/weixin/qr/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            loginId: startJson.loginId,
            displayName: displayNameRef.current.trim(),
          }),
          signal: ac.signal,
        });
        const pollJson = (await pollRes.json()) as {
          phase?: string;
          error?: string;
          qrContent?: string;
          message?: string;
          accountId?: string;
          botId?: string | null;
        };

        if (myGeneration !== qrFlowGenerationRef.current) return;

        if (!pollRes.ok) {
          throw new Error(pollJson.error ?? t("auth.weixinErrorLoginFailed"));
        }

        if (pollJson.phase === "waiting") {
          setQrPhase("waiting");
          await new Promise((r) => setTimeout(r, 250));
          continue;
        }
        if (pollJson.phase === "scanned") {
          setQrPhase("scanned");
          await new Promise((r) => setTimeout(r, 250));
          continue;
        }
        if (pollJson.phase === "expired") {
          setQrPhase("expired");
          if (pollJson.qrContent) {
            setQrContent(pollJson.qrContent);
          }
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        if (pollJson.phase === "done") {
          setStatus("completed");
          try {
            const cloudAuthToken =
              typeof window !== "undefined" ? getAuthToken() : null;
            await fetch("/api/weixin/listener/init", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(cloudAuthToken ? { cloudAuthToken } : {}),
            });
          } catch (e) {
            console.warn("[Weixin] Failed to start listener:", e);
          }
          toast({
            type: "success",
            description: t("auth.weixinConnectSuccess"),
          });
          router.push(getHomePath());
          router.refresh();
          setTimeout(() => {
            handleCloseRef.current();
            onSuccessRef.current?.();
          }, 800);
          return;
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      if (myGeneration !== qrFlowGenerationRef.current) return;
      setStatus("error");
      const msg = error instanceof Error ? error.message : t("common.error");
      setErrorMessage(msg);
      setQrPhase("idle");
      setQrContent(null);
      loginIdRef.current = null;
    }
  }, [t, router, cancelQrSession]);

  useEffect(() => {
    return () => {
      pollAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void startQrFlow();
  }, [isOpen, startQrFlow]);

  const phaseHint =
    qrPhase === "scanned"
      ? t("auth.weixinQrScanned")
      : qrPhase === "expired"
        ? t("auth.weixinQrRefreshed")
        : t("auth.weixinQrHint");

  const formBody = (
    <div className="space-y-4 py-2">
      <button
        type="button"
        onClick={() => setStepsOpen(true)}
        className="text-primary underline text-sm bg-transparent border-none cursor-pointer p-0"
      >
        {t("auth.weixinHelpLink")}
      </button>
      <div className="space-y-2">
        <Label htmlFor="weixin-display-name">
          {t("auth.weixinDisplayName")}
        </Label>
        <Input
          id="weixin-display-name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={t("auth.weixinDisplayNamePlaceholder")}
        />
      </div>

      <div className="space-y-3 rounded-xl border border-border/60 bg-muted/30 p-4">
        {status === "connecting" && !qrContent ? (
          <div className="flex flex-col items-center justify-center gap-3 py-8">
            <Spinner
              size={36}
              label={t("auth.weixinQrLoading")}
              className="text-muted-foreground"
            />
          </div>
        ) : status === "error" ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            {t("auth.weixinQrLoadFailed")}
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{phaseHint}</p>
            {qrContent ? (
              <div className="flex justify-center rounded-lg bg-white p-3">
                {shouldRenderQrAsImage(qrContent) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={qrContent}
                    alt={t("auth.weixinQrAlt")}
                    className="max-h-[220px] w-auto object-contain"
                  />
                ) : (
                  <QRCodeSVG
                    value={qrContent}
                    size={220}
                    level="M"
                    includeMargin
                    className="h-auto w-full max-w-[220px]"
                  />
                )}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {status === "connecting" && qrContent ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    qrFlowGenerationRef.current += 1;
                    pollAbortRef.current?.abort();
                    void cancelQrSession(loginIdRef.current);
                    setErrorMessage(null);
                    void startQrFlow();
                  }}
                >
                  {t("auth.weixinQrRefresh")}
                </Button>
              ) : null}
            </div>
          </>
        )}
      </div>

      {errorMessage ? (
        <div className="space-y-2">
          <p className="text-sm text-red-600">{errorMessage}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setErrorMessage(null);
              void startQrFlow();
            }}
          >
            {t("common.retry")}
          </Button>
        </div>
      ) : null}

      {!embedded && (
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={handleClose}>
            {t("common.close")}
          </Button>
        </div>
      )}
    </div>
  );

  if (embedded) {
    return (
      <>
        {formBody}
        <WeixinStepsDialog open={stepsOpen} onOpenChange={setStepsOpen} />
      </>
    );
  }

  return (
    <>
      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogContent
          className="max-w-2xl max-h-[85vh] overflow-y-auto !z-[1020]"
          overlayClassName="!z-[1019]"
        >
          <DialogHeader>
            <DialogTitle>{t("auth.weixinTitle")}</DialogTitle>
            <DialogDescription className="text-left">
              <button
                type="button"
                onClick={() => setStepsOpen(true)}
                className="text-primary underline text-sm bg-transparent border-none cursor-pointer p-0"
              >
                {t("auth.weixinHelpLink")}
              </button>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="weixin-display-name">
                {t("auth.weixinDisplayName")}
              </Label>
              <Input
                id="weixin-display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t("auth.weixinDisplayNamePlaceholder")}
              />
            </div>
            <div className="space-y-3 rounded-xl border border-border/60 bg-muted/30 p-4">
              {status === "connecting" && !qrContent ? (
                <div className="flex flex-col items-center justify-center gap-3 py-8">
                  <Spinner
                    size={36}
                    label={t("auth.weixinQrLoading")}
                    className="text-muted-foreground"
                  />
                </div>
              ) : status === "error" ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  {t("auth.weixinQrLoadFailed")}
                </p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">{phaseHint}</p>
                  {qrContent ? (
                    <div className="flex justify-center rounded-lg bg-white p-3">
                      {shouldRenderQrAsImage(qrContent) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={qrContent}
                          alt={t("auth.weixinQrAlt")}
                          className="max-h-[220px] w-auto object-contain"
                        />
                      ) : (
                        <QRCodeSVG
                          value={qrContent}
                          size={220}
                          level="M"
                          includeMargin
                          className="h-auto w-full max-w-[220px]"
                        />
                      )}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    {status === "connecting" && qrContent ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          qrFlowGenerationRef.current += 1;
                          pollAbortRef.current?.abort();
                          void cancelQrSession(loginIdRef.current);
                          setErrorMessage(null);
                          void startQrFlow();
                        }}
                      >
                        {t("auth.weixinQrRefresh")}
                      </Button>
                    ) : null}
                  </div>
                </>
              )}
            </div>
            {errorMessage ? (
              <div className="space-y-2">
                <p className="text-sm text-red-600">{errorMessage}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setErrorMessage(null);
                    void startQrFlow();
                  }}
                >
                  {t("common.retry")}
                </Button>
              </div>
            ) : null}
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={handleClose}>
              {t("common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <WeixinStepsDialog open={stepsOpen} onOpenChange={setStepsOpen} />
    </>
  );
}
