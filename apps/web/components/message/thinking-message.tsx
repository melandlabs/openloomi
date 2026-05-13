"use client";

import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import cx from "classnames";
import { Spinner } from "@/components/spinner";

export function ThinkingMessage() {
  const role = "assistant";
  const { t } = useTranslation();

  return (
    <motion.div
      data-testid="message-assistant-loading"
      className="w-full px-0 group/message mt-2 mb-16"
      initial={{ y: 5, opacity: 0 }}
      animate={{ y: 0, opacity: 1, transition: { delay: 1 } }}
      data-role={role}
    >
      <div
        className={cx(
          "rounded-lg border border-border bg-card/50 mt-2 mb-2",
          "group-data-[role=user]/message:w-fit group-data-[role=user]/message:ml-auto group-data-[role=user]/message:max-w-2xl",
        )}
      >
        <div className="flex items-center gap-3 px-3 py-2 text-sm text-muted-foreground">
          <div className="flex items-center justify-center">
            <Spinner size={26} label="AI is responding..." />
          </div>

          <div className="flex flex-col">
            <span className="font-medium text-slate-700 dark:text-slate-200">
              {t("common.thinking", "openloomi is thinking...")}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {t("common.generating", "Crafting best reply for you")}
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
