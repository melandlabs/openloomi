"use client";

import cx from "classnames";
import { motion } from "framer-motion";
import type { Attachment } from "@openloomi/shared";
import type React from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowUpIcon, StopIcon } from "@/components/icons";
import { ComposerAttachmentCard } from "@/components/chat/composer-attachment-card";
import { RemixIcon } from "@/components/remix-icon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import { useAudioRecording } from "@/hooks/use-audio-recording";
import { SUPPORTED_FILE_EXTENSIONS } from "@/lib/files/config";
import { uploadFile } from "@/lib/files/upload";
import { useAttachmentUpload } from "./use-attachment-upload";
import type { TaskComposerProps, TaskComposerSubmitPayload } from "./types";
import { VoiceRecordingBar } from "./voice-recording-bar";
import { useVoice } from "@/components/audio/voice-provider";

const isTauriEnv = typeof window !== "undefined" && "__TAURI__" in window;
const IME_COMPOSITION_BUFFER_MS = 120;
const TEXTAREA_LINE_HEIGHT_PX = 20;
const DEFAULT_VISIBLE_LINES = 2;
const MAX_VISIBLE_LINES = 7;
const MIN_TEXTAREA_HEIGHT_PX = TEXTAREA_LINE_HEIGHT_PX * DEFAULT_VISIBLE_LINES;
const MAX_TEXTAREA_HEIGHT_PX = TEXTAREA_LINE_HEIGHT_PX * MAX_VISIBLE_LINES;
const MAX_TEXT_LENGTH = 5000;
const TASK_COMPOSER_MAX_WIDTH_CLASS = "max-w-[730px]";

function isImageAttachmentMissingLocalSource(attachment: Attachment): boolean {
  const file =
    typeof File !== "undefined" && (attachment as any).file instanceof File
      ? ((attachment as any).file as File)
      : null;

  return (
    attachment.contentType.startsWith("image/") &&
    !file &&
    !attachment.downloadUrl &&
    !attachment.blobPath &&
    !attachment.url &&
    !(attachment as any).isUploading
  );
}

function extractClipboardFiles(clipboardData: DataTransfer | null): File[] {
  if (!clipboardData) return [];

  const files: File[] = [];
  const items = clipboardData.items;
  if (items && items.length > 0) {
    for (const item of Array.from(items)) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (!file) continue;
      files.push(file);
    }
  }

  if (files.length > 0) return files;
  return Array.from(clipboardData.files ?? []);
}

async function readFileAsBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Failed to read screenshot file"));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read screenshot file"));
    reader.readAsDataURL(file);
  });

  const [, base64 = ""] = dataUrl.split(",", 2);
  return base64;
}

async function importTauriEvent() {
  if (!isTauriEnv) return null;
  try {
    return await import("@tauri-apps/api/event");
  } catch {
    return null;
  }
}

function PureTaskComposer({
  value,
  setValue,
  attachments,
  setAttachments,
  onSubmit,
  onStop,
  isAgentRunning = false,
  isSending = false,
  isSubmitting = false,
  isLocked = false,
  placement = "docked",
  placeholder,
  className,
  layoutId,
  isUploadingFile: controlledUploadingState,
  onFilesSelected,
  enableDropzone = true,
}: TaskComposerProps) {
  const { t } = useTranslation();
  const { whisper } = useVoice();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const compositionEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const isComposingOrJustEndedRef = useRef(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isScreenshotting, setIsScreenshotting] = useState(false);
  const dragCounterRef = useRef(0);
  const focusTextarea = useCallback(() => {
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);
  const {
    isUploadingFile: internalUploadingState,
    handleFileUpload: internalHandleFileUpload,
    handleTauriFileDrop,
  } = useAttachmentUpload({
    setAttachments,
    onUploadComplete: focusTextarea,
  });
  const effectiveUploadingState =
    (controlledUploadingState ?? internalUploadingState) || isScreenshotting;
  const handleFileSelection = onFilesSelected ?? internalHandleFileUpload;

  const showSendingState =
    effectiveUploadingState || isSubmitting || (!isAgentRunning && isSending);
  const composerBusy =
    effectiveUploadingState || isSubmitting || (!isAgentRunning && isSending);
  // Check if any attachment is still uploading (extended UploadingAttachment field)
  const hasUploadingAttachment = attachments.some(
    (att) => (att as any).isUploading,
  );
  const hasImageMissingLocalSource = attachments.some(
    isImageAttachmentMissingLocalSource,
  );
  const hasComposerContent = value.trim().length > 0 || attachments.length > 0;
  const sendDisabled =
    composerBusy ||
    isLocked ||
    !hasComposerContent ||
    hasUploadingAttachment ||
    hasImageMissingLocalSource;
  const sendButtonMuted =
    !hasComposerContent &&
    !composerBusy &&
    !isLocked &&
    !hasUploadingAttachment &&
    !hasImageMissingLocalSource;

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;

    el.style.lineHeight = `${TEXTAREA_LINE_HEIGHT_PX}px`;
    el.style.height = "auto";

    const nextHeight = Math.max(
      MIN_TEXTAREA_HEIGHT_PX,
      Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT_PX),
    );

    el.style.height = `${nextHeight}px`;
    el.style.overflowY =
      el.scrollHeight > MAX_TEXTAREA_HEIGHT_PX ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [adjustHeight, value]);

  useEffect(() => {
    return () => {
      if (compositionEndTimerRef.current) {
        clearTimeout(compositionEndTimerRef.current);
      }
    };
  }, []);

  const {
    phase,
    isRecordingAudio,
    isProcessingAudio,
    waveformSamples,
    durationText,
    startRecording,
    confirmRecording,
    cancelRecording,
    cancelProcessing,
  } = useAudioRecording({
    onTranscriptionComplete: useCallback(
      (text: string) => {
        setValue((prev) => {
          const spacer = prev.trim().length > 0 ? "\n" : "";
          return `${prev}${spacer}${text}`;
        });
        setTimeout(() => textareaRef.current?.focus(), 0);
      },
      [setValue],
    ),
  });
  const isVoiceActive = phase !== "idle";

  const handleSubmit = useCallback(() => {
    if (composerBusy || isLocked || hasUploadingAttachment) return;
    if (!hasComposerContent) return;
    if (hasImageMissingLocalSource) {
      toast.error(t("chat.imageUploadFailed", "Image upload failed"));
      return;
    }

    const payload: TaskComposerSubmitPayload = {
      text: value.slice(0, MAX_TEXT_LENGTH).trim(),
      attachments,
    };
    void onSubmit(payload);
  }, [
    attachments,
    composerBusy,
    hasComposerContent,
    hasImageMissingLocalSource,
    hasUploadingAttachment,
    isLocked,
    onSubmit,
    t,
    value,
  ]);

  const handleDragEnter = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!enableDropzone) return;
      event.preventDefault();
      event.stopPropagation();
      dragCounterRef.current += 1;
      if (event.dataTransfer.items && event.dataTransfer.items.length > 0) {
        setIsDraggingFile(true);
      }
    },
    [enableDropzone],
  );

  const handleDragLeave = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!enableDropzone) return;
      event.preventDefault();
      event.stopPropagation();
      dragCounterRef.current -= 1;
      if (dragCounterRef.current === 0) {
        setIsDraggingFile(false);
      }
    },
    [enableDropzone],
  );

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!enableDropzone) return;
      event.preventDefault();
      event.stopPropagation();
    },
    [enableDropzone],
  );

  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      if (!enableDropzone) return;
      event.preventDefault();
      event.stopPropagation();
      setIsDraggingFile(false);
      dragCounterRef.current = 0;

      const files = event.dataTransfer.files;
      if (files && files.length > 0) {
        await handleFileSelection(files);
      }
    },
    [enableDropzone, handleFileSelection],
  );

  const handlePaste = useCallback(
    async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const files = extractClipboardFiles(event.clipboardData);
      if (files.length === 0) return;

      event.preventDefault();
      if (composerBusy || isLocked || isVoiceActive) return;

      await handleFileSelection(files);
    },
    [composerBusy, handleFileSelection, isLocked, isVoiceActive],
  );

  const captureScreenshot = async (): Promise<Blob> => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error("Screen capture is not supported in this environment");
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: true,
    });

    const video = document.createElement("video");
    video.srcObject = stream;

    try {
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error("Failed to load screen stream"));
      });
      await video.play();

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("Canvas context unavailable");
      }
      ctx.drawImage(video, 0, 0);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob) {
        throw new Error("Canvas toBlob failed");
      }
      return blob;
    } finally {
      stream.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    }
  };

  const handleScreenshot = useCallback(async () => {
    if (composerBusy || isLocked || isVoiceActive || isScreenshotting) return;
    setIsScreenshotting(true);

    try {
      const blob = await captureScreenshot();

      const fileName = `screenshot-${Date.now()}.png`;
      const file = new File([blob], fileName, { type: "image/png" });
      const result = await uploadFile(file, { createRecord: false });

      const attachment: Attachment & {
        file?: File;
      } = {
        name: result.name || fileName,
        url: result.url,
        downloadUrl: result.downloadUrl,
        blobPath: result.blobPath,
        contentType: result.contentType,
        sizeBytes: result.size,
        file,
      };

      setAttachments((prev) => [...prev, attachment]);
      focusTextarea();

      toast.success(
        t("chat.screenshotCaptured", "Screenshot captured and added to input"),
      );
    } catch (error) {
      console.error("[TaskComposer] Failed to capture screenshot:", error);
      if (
        error instanceof DOMException &&
        (error.name === "NotAllowedError" || error.name === "AbortError")
      ) {
        return;
      }

      toast.error(
        t("chat.screenshotFailed", "Screenshot failed, please try again"),
      );
    } finally {
      setIsScreenshotting(false);
    }
  }, [
    composerBusy,
    focusTextarea,
    isLocked,
    isScreenshotting,
    isVoiceActive,
    setAttachments,
    t,
  ]);

  useEffect(() => {
    if (!isTauriEnv || !enableDropzone || onFilesSelected) return;

    let unlistenFileDrop: (() => void) | null = null;
    let unlistenFileDropHover: (() => void) | null = null;
    let unlistenFileDropCancelled: (() => void) | null = null;

    const setupTauriListeners = async () => {
      try {
        const eventModule = await importTauriEvent();
        if (!eventModule) return;

        unlistenFileDrop = await eventModule.listen<string[]>(
          "tauri://file-drop",
          (event) => {
            setIsDraggingFile(false);
            dragCounterRef.current = 0;
            void handleTauriFileDrop(event.payload);
          },
        );

        unlistenFileDropHover = await eventModule.listen<string[]>(
          "tauri://file-drop-hover",
          (event) => {
            if (event.payload.length > 0) {
              setIsDraggingFile(true);
            }
          },
        );

        unlistenFileDropCancelled = await eventModule.listen(
          "tauri://file-drop-cancelled",
          () => {
            setIsDraggingFile(false);
            dragCounterRef.current = 0;
          },
        );
      } catch (error) {
        console.error("[TaskComposer] Failed to setup Tauri listeners:", error);
      }
    };

    void setupTauriListeners();

    return () => {
      unlistenFileDrop?.();
      unlistenFileDropHover?.();
      unlistenFileDropCancelled?.();
    };
  }, [enableDropzone, handleTauriFileDrop, onFilesSelected]);

  const shellClasses = useMemo(
    () => cx("relative w-full", TASK_COMPOSER_MAX_WIDTH_CLASS, className),
    [className],
  );

  return (
    <motion.div
      layoutId={layoutId}
      transition={{ type: "spring", stiffness: 320, damping: 32 }}
      className={shellClasses}
      onDragEnter={enableDropzone ? handleDragEnter : undefined}
      onDragLeave={enableDropzone ? handleDragLeave : undefined}
      onDragOver={enableDropzone ? handleDragOver : undefined}
      onDrop={enableDropzone ? handleDrop : undefined}
      role="region"
      aria-label={t("chat.fileDropArea", "File drop area")}
    >
      {isDraggingFile && (
        <div className="absolute inset-0 z-50 flex items-center justify-center rounded-[16px] border-2 border-dashed border-primary bg-primary/10 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 text-primary">
            <div className="rounded-full bg-primary/20 p-4">
              <RemixIcon name="attachment" size="size-8" />
            </div>
            <div className="text-lg font-semibold">
              {t("chat.dropFilesHere", "Drop files here")}
            </div>
            <div className="text-sm opacity-80">
              {t(
                "chat.supportedFileTypes",
                "Images and documents (PDF, DOC, PPT, TXT)",
              )}
            </div>
          </div>
        </div>
      )}

      <div className="rounded-[16px] border border-[#E9E9E9] bg-[#FFFFFF] shadow-[0_4px_12px_0_rgba(167,167,167,0.12)]">
        <div className="p-3">
          {attachments.length > 0 ? (
            <div className="no-scrollbar mb-3 flex gap-2 overflow-x-auto">
              {attachments.map((attachment, index) => (
                <ComposerAttachmentCard
                  key={`${attachment.url}:${index}`}
                  name={attachment.name}
                  mediaType={attachment.contentType}
                  sizeBytes={attachment.sizeBytes}
                  onRemove={() =>
                    setAttachments((prev) => prev.filter((_, i) => i !== index))
                  }
                  removeAriaLabel={t("common.remove", "Remove")}
                  isBusy={(attachment as any).isUploading}
                  statusLabel={t("chat.uploading", "Uploading...")}
                />
              ))}
            </div>
          ) : null}

          <div className="relative">
            <Textarea
              ref={textareaRef}
              value={value}
              onChange={(event) => {
                const next = event.target.value;
                if (next.length > MAX_TEXT_LENGTH) {
                  setValue(next.slice(0, MAX_TEXT_LENGTH));
                  return;
                }
                setValue(next);
              }}
              onPaste={(event) => {
                void handlePaste(event);
              }}
              onCompositionStart={() => {
                if (compositionEndTimerRef.current) {
                  clearTimeout(compositionEndTimerRef.current);
                  compositionEndTimerRef.current = null;
                }
                isComposingOrJustEndedRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingOrJustEndedRef.current = true;
                if (compositionEndTimerRef.current) {
                  clearTimeout(compositionEndTimerRef.current);
                }
                compositionEndTimerRef.current = setTimeout(() => {
                  compositionEndTimerRef.current = null;
                  isComposingOrJustEndedRef.current = false;
                }, IME_COMPOSITION_BUFFER_MS);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey) return;
                if (
                  event.nativeEvent.isComposing ||
                  isComposingOrJustEndedRef.current
                ) {
                  event.preventDefault();
                  return;
                }
                event.preventDefault();
                if (composerBusy || isLocked || isVoiceActive) return;
                handleSubmit();
              }}
              placeholder={placeholder ?? t("common.message")}
              className={cx(
                "min-h-0 w-full resize-none rounded-none border-0 bg-transparent px-0 py-0 text-left text-[14px] font-normal leading-5 text-[#000000] normal-case shadow-none outline-none ring-0 ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0",
                isVoiceActive ? "pointer-events-none opacity-100" : "",
              )}
              style={{ fontFamily: "PingFang SC, PingFang SC" }}
              rows={2}
              readOnly={isVoiceActive}
              disabled={isLocked}
            />

            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="group flex size-8 items-center justify-center rounded-full bg-transparent p-0 transition-colors hover:bg-[#D9D9D9] disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => {
                        if (composerBusy || isLocked) return;
                        fileInputRef.current?.click();
                      }}
                      disabled={composerBusy || isLocked || isVoiceActive}
                      aria-label={t(
                        "chat.uploadFileFromLocal",
                        "Upload from local",
                      )}
                    >
                      <RemixIcon name="attachment" size="size-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <span className="text-xs">
                      {t("chat.uploadFileFromLocal", "Upload from local")}
                    </span>
                  </TooltipContent>
                </Tooltip>
                {/* <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="group flex size-8 items-center justify-center rounded-full bg-transparent p-0 transition-colors hover:bg-[#D9D9D9] disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => {
                        void handleScreenshot();
                      }}
                      disabled={
                        composerBusy ||
                        isLocked ||
                        isVoiceActive ||
                        isScreenshotting
                      }
                      aria-label={t("chat.screenshot", "Screenshot")}
                    >
                      {isScreenshotting ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      ) : (
                        <RemixIcon name="screenshot_2" size="size-4" />
                      )}
                    </button>
                  </TooltipTrigger>
                  {!isScreenshotting ? (
                    <TooltipContent>
                      <span className="text-xs">
                        {t("chat.screenshotHint", "Capture screenshot")}
                      </span>
                    </TooltipContent>
                  ) : null}
                </Tooltip> */}
                {value.length >= MAX_TEXT_LENGTH && (
                  <span className="shrink-0 text-xs tabular-nums">
                    <span style={{ color: "#E84937" }}>{value.length}</span>
                    <span style={{ color: "rgba(0,0,0,0.5)" }}>
                      /{MAX_TEXT_LENGTH}
                    </span>
                  </span>
                )}
              </div>

              {isVoiceActive && whisper.enabled ? (
                <div className="min-w-0 flex-1">
                  <VoiceRecordingBar
                    phase={phase}
                    durationText={durationText}
                    waveformSamples={waveformSamples}
                    onCancel={() => {
                      if (isRecordingAudio) {
                        void cancelRecording();
                        return;
                      }
                      cancelProcessing();
                    }}
                    onConfirm={() => {
                      if (!isRecordingAudio) return;
                      void confirmRecording();
                    }}
                    disableCancel={false}
                    disableConfirm={!isRecordingAudio}
                  />
                </div>
              ) : (
                <div className="flex shrink-0 items-center gap-2">
                  {whisper.enabled && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className={cx(
                            "group flex size-8 items-center justify-center rounded-full bg-transparent p-0 transition-colors hover:bg-[#D9D9D9]",
                            isProcessingAudio ? "text-primary" : "",
                          )}
                          onClick={() => {
                            if (composerBusy || isLocked) return;
                            void startRecording();
                          }}
                          aria-label={t("chat.audioInput", "Voice input")}
                        >
                          <RemixIcon
                            name="mic"
                            size="size-4"
                            className="shrink-0"
                          />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <span className="text-xs">
                          {t(
                            "chat.audioStartRecord",
                            "Click to start recording",
                          )}
                        </span>
                      </TooltipContent>
                    </Tooltip>
                  )}

                  {isAgentRunning && onStop ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="flex size-8 shrink-0 items-center justify-center rounded-[16px] text-white"
                          style={{ backgroundColor: "#000000" }}
                          onClick={(event) => {
                            event.preventDefault();
                            onStop();
                          }}
                          aria-label={t(
                            "chat.stopGenerating",
                            "Stop generating",
                          )}
                        >
                          <StopIcon size={16} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <span className="text-xs">
                          {t("chat.stopGenerating", "Stop generating")}
                        </span>
                      </TooltipContent>
                    </Tooltip>
                  ) : null}

                  {!isAgentRunning ? (
                    <button
                      type="button"
                      className={cx(
                        "flex size-8 shrink-0 items-center justify-center rounded-[16px] p-0 text-white focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed",
                      )}
                      style={{
                        backgroundColor: sendButtonMuted
                          ? "rgba(0,0,0,0.3)"
                          : "#000000",
                      }}
                      onClick={(event) => {
                        event.preventDefault();
                        handleSubmit();
                      }}
                      disabled={sendDisabled || isVoiceActive}
                      aria-label={
                        effectiveUploadingState
                          ? t("chat.uploading", "Uploading file...")
                          : showSendingState
                            ? t("chat.sending", "Sending...")
                            : t("chat.send", "Send message")
                      }
                    >
                      {showSendingState ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      ) : (
                        <ArrowUpIcon size={16} />
                      )}
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept={SUPPORTED_FILE_EXTENSIONS.join(",")}
        multiple
        onChange={(event) => {
          void handleFileSelection(event.target.files);
          event.target.value = "";
        }}
        disabled={composerBusy || isLocked || isVoiceActive}
      />
    </motion.div>
  );
}

export const TaskComposer = memo(PureTaskComposer);
