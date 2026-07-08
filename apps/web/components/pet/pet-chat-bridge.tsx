"use client";

/**
 * Bridge between Tauri DOM events (dispatched by the Rust host on the
 * main webview) and the chat composer. The Rust
 * `pet:guide-connect-more` listener in main.rs emits an
 * `openloomi:send-chat-message` CustomEvent with `{ text: <prompt> }`;
 * we forward the text into the chat via
 * useChatContext().sendMessage(...) so the user lands on a fresh user
 * turn that the agent can act on.
 *
 * Why this lives in the (chat) layout (and not in Home):
 *   LoopNavBridge is mounted at the layout level for the same reason —
 *   the event can fire while the user is on /chat, /connectors, /brief,
 *   etc. Mounting the bridge here keeps the wiring working from any
 *   (chat) route, and ensures useChatContext is available above us
 *   (the provider is mounted in layout.tsx).
 */
import { useEffect } from "react";
import { useChatContext } from "@/components/chat-context";

export function PetChatBridge() {
  const { sendMessage, switchChatId } = useChatContext();
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ text?: string }>;
      const text = ce.detail?.text?.trim();
      if (!text) return;
      // Start a fresh chat so the user prompt is not injected into an
      // unrelated in-flight conversation. Mirrors the pattern used by
      // AgentChatPanel's initialMessageToSend effect (see
      // apps/web/components/agent/chat-panel.tsx).
      switchChatId(null);
      // Tiny delay so context state propagates before we send; matches
      // the 350ms used by AgentChatPanel.
      setTimeout(() => {
        void sendMessage({ parts: [{ type: "text", text }] });
      }, 350);
    };
    window.addEventListener("openloomi:send-chat-message", handler);
    return () =>
      window.removeEventListener("openloomi:send-chat-message", handler);
  }, [sendMessage, switchChatId]);
  return null;
}
