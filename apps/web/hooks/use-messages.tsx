import { useState, useEffect } from "react";
import { useScrollToBottom } from "@openloomi/hooks/use-scroll-to-bottom";

export function useMessages({
  chatId,
  isAgentRunning,
}: {
  chatId: string;
  isAgentRunning: boolean;
}) {
  const { containerRef, endRef, isAtBottom, scrollToBottom } =
    useScrollToBottom();

  const [hasSentMessage, setHasSentMessage] = useState(false);

  useEffect(() => {
    if (chatId) {
      scrollToBottom("instant");
      setHasSentMessage(false);
    }
  }, [chatId, scrollToBottom]);

  useEffect(() => {
    if (isAgentRunning) {
      setHasSentMessage(true);
    }
  }, [isAgentRunning]);

  return {
    containerRef,
    endRef,
    isAtBottom,
    scrollToBottom,
    hasSentMessage,
  };
}
