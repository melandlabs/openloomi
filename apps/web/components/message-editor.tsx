"use client";

import { Button } from "./ui/button";
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";
import { Textarea } from "./ui/textarea";
import { deleteTrailingMessages } from "@/app/(chat)/actions";
import type { UseChatHelpers } from "@ai-sdk/react";
import type { ChatMessage } from "@openloomi/shared";
import { getTextFromMessage } from "@/lib/utils";
import { useTranslation } from "react-i18next";

export type MessageEditorProps = {
  message: ChatMessage;
  setMode: Dispatch<SetStateAction<"view" | "edit">>;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
};

export function MessageEditor({
  message,
  setMode,
  setMessages,
}: MessageEditorProps) {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const [draftContent, setDraftContent] = useState<string>(
    getTextFromMessage(message),
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { t } = useTranslation();

  useEffect(() => {
    if (textareaRef.current) {
      adjustHeight();
    }
  }, []);

  const adjustHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight + 2}px`;
    }
  };

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraftContent(event.target.value);
    adjustHeight();
  };

  return (
    <div className="flex flex-col gap-2 w-full">
      <Textarea
        data-testid="message-editor"
        ref={textareaRef}
        className="bg-background-card outline-none overflow-hidden resize-none !text-base rounded-xl w-full"
        value={draftContent}
        onChange={handleInput}
      />

      <div className="flex w-full flex-row gap-2 justify-end">
        <Button
          variant="outline"
          className="h-fit py-2 px-3"
          onClick={() => {
            setMode("view");
          }}
        >
          {t("common.cancel")}
        </Button>
        <Button
          data-testid="message-editor-send-button"
          variant="default"
          className="h-fit py-2 px-3"
          disabled={isSubmitting}
          onClick={async () => {
            setIsSubmitting(true);

            await deleteTrailingMessages({
              id: message.id,
            });

            setMessages((messages) => {
              const index = messages.findIndex((m) => m.id === message.id);

              if (index !== -1) {
                const updatedMessage: ChatMessage = {
                  ...message,
                  parts: [{ type: "text", text: draftContent }],
                };

                return [...messages.slice(0, index), updatedMessage];
              }

              return messages;
            });

            setMode("view");
          }}
        >
          {isSubmitting ? t("common.sending") : t("common.send")}
        </Button>
      </div>
    </div>
  );
}
