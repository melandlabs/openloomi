"use client";

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RemixIcon } from "@/components/remix-icon";
import {
  isAccessibilityGranted,
  isScreenRecordingGranted,
  requestAccessibilityAccess,
  requestScreenRecordingAccess,
  openAccessibilitySettings,
  openScreenRecordingSettings,
} from "@/lib/permissions/service";

export type PermissionGuideStep =
  | "initial"
  | "accessibility-granting"
  | "accessibility-done"
  | "screen-recording-granting"
  | "screen-recording-done";

interface ChroniclePermissionGuideProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

export function ChroniclePermissionGuide({
  open,
  onOpenChange,
  onComplete,
}: ChroniclePermissionGuideProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<PermissionGuideStep>("initial");
  const [accessibilityGranted, setAccessibilityGranted] = useState(false);
  const [screenRecordingGranted, setScreenRecordingGranted] = useState(false);

  // Check initial permission states when dialog opens
  useEffect(() => {
    if (!open) return;

    const checkPermissions = async () => {
      const [acc, screen] = await Promise.all([
        isAccessibilityGranted(true),
        isScreenRecordingGranted(true),
      ]);
      setAccessibilityGranted(acc);
      setScreenRecordingGranted(screen);

      // If both already granted, complete immediately
      if (acc && screen) {
        setStep("initial");
        onComplete();
        onOpenChange(false);
        return;
      }

      // If accessibility not granted, start with accessibility
      if (!acc) {
        setStep("initial");
      } else if (!screen) {
        // Accessibility already granted, go to screen recording
        setStep("accessibility-done");
      }
    };

    void checkPermissions();
  }, [open, onComplete, onOpenChange]);

  // Listen for window focus to detect when user returns from system settings
  useEffect(() => {
    if (!open) return;

    const handleFocus = async () => {
      if (step === "accessibility-granting") {
        const granted = await isAccessibilityGranted(true);
        setAccessibilityGranted(granted);
        if (granted) {
          setStep("accessibility-done");
        } else {
          setStep("initial");
        }
      } else if (step === "screen-recording-granting") {
        const granted = await isScreenRecordingGranted(true);
        setScreenRecordingGranted(granted);
        if (granted) {
          setStep("screen-recording-done");
        }
      }
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [open, step]);

  const handleRequestAccessibility = async () => {
    setStep("accessibility-granting");
    const granted = await requestAccessibilityAccess();
    if (granted) {
      setAccessibilityGranted(true);
      setStep("accessibility-done");
      return;
    }
    const currentGranted = await isAccessibilityGranted(true);
    if (currentGranted) {
      setAccessibilityGranted(true);
      setStep("accessibility-done");
      return;
    }
    await openAccessibilitySettings();
  };

  const handleRequestScreenRecording = async () => {
    setStep("screen-recording-granting");
    const granted = await requestScreenRecordingAccess();
    if (granted) {
      setScreenRecordingGranted(true);
      setStep("screen-recording-done");
      return;
    }
    const currentGranted = await isScreenRecordingGranted(true);
    if (currentGranted) {
      setScreenRecordingGranted(true);
      setStep("screen-recording-done");
      return;
    }
    await openScreenRecordingSettings();
  };

  const handleComplete = () => {
    onComplete();
    onOpenChange(false);
    setStep("initial");
  };

  const handleClose = () => {
    onOpenChange(false);
    setStep("initial");
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RemixIcon name="shield-check" className="size-5 text-primary" />
            {t("chronicle.permissionGuide.title")}
          </DialogTitle>
          <DialogDescription>
            {t("chronicle.permissionGuide.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Step 1: Accessibility */}
          <div
            className="flex items-start gap-3 p-3 rounded-lg border bg-card cursor-pointer hover:bg-accent/50 transition-colors"
            onClick={handleRequestAccessibility}
            role="button"
            tabIndex={0}
          >
            <div
              className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${
                accessibilityGranted
                  ? "bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-400"
                  : step === "accessibility-granting"
                    ? "bg-yellow-100 text-yellow-600 dark:bg-yellow-900 dark:text-yellow-400"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {accessibilityGranted ? (
                <RemixIcon name="check" className="size-4" />
              ) : step === "accessibility-granting" ? (
                <RemixIcon name="loader_2" className="size-4 animate-spin" />
              ) : (
                <span className="text-xs font-medium">1</span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">
                {t("chronicle.permissionGuide.accessibilityTitle")}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("chronicle.permissionGuide.accessibilityDesc")}
              </p>
            </div>
          </div>

          {/* Step 2: Screen Recording */}
          <div
            className="flex items-start gap-3 p-3 rounded-lg border bg-card cursor-pointer hover:bg-accent/50 transition-colors"
            onClick={handleRequestScreenRecording}
            role="button"
            tabIndex={0}
          >
            <div
              className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${
                screenRecordingGranted
                  ? "bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-400"
                  : step === "screen-recording-granting"
                    ? "bg-yellow-100 text-yellow-600 dark:bg-yellow-900 dark:text-yellow-400"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {screenRecordingGranted ? (
                <RemixIcon name="check" className="size-4" />
              ) : step === "screen-recording-granting" ? (
                <RemixIcon name="loader_2" className="size-4 animate-spin" />
              ) : (
                <span className="text-xs font-medium">2</span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">
                {t("chronicle.permissionGuide.screenRecordingTitle")}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("chronicle.permissionGuide.screenRecordingDesc")}
              </p>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={handleClose}
            className="w-full sm:w-auto"
          >
            {t("chronicle.permissionGuide.cancel")}
          </Button>
          {accessibilityGranted && screenRecordingGranted && (
            <Button onClick={handleComplete} className="w-full sm:w-auto">
              <RemixIcon name="check" className="size-4 mr-1" />
              {t("chronicle.permissionGuide.complete")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
