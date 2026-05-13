import Image from "next/image";
import { RemixIcon } from "@/components/remix-icon";
import { cn } from "@/lib/utils";
import type { FocusSource } from "@/lib/types/daily-focus";
import type { IntegrationId } from "@/hooks/use-integrations";

const SOURCE_TO_PLATFORM: Record<string, IntegrationId> = {
  email: "gmail",
  slack: "slack",
  wechat: "weixin",
  telegram: "telegram",
  whatsapp: "whatsapp",
  feishu: "feishu",
  lark: "feishu",
  dingtalk: "dingtalk",
  notion: "notion",
  "google-drive": "google_drive",
  google_drive: "google_drive",
  jira: "jira",
  linear: "linear",
  gmail: "gmail",
  outlook: "outlook",
  飞书: "feishu",
  微信: "weixin",
  钉钉: "dingtalk",
};

const PLATFORM_LOGO_MAP: Record<string, string> = {
  slack: "/images/apps/slack.png",
  telegram: "/images/apps/telegram.png",
  whatsapp: "/images/apps/whatsapp.png",
  gmail: "/images/apps/gmail.png",
  weixin: "/images/apps/WeChat.png",
  feishu: "/images/apps/feishu.png",
  dingtalk: "/images/apps/DingTalk.png",
  notion: "/images/apps/notion.png",
  google_drive: "/images/apps/google_drive.png",
  jira: "/images/apps/jira.png",
  linear: "/images/apps/linear.png",
  outlook: "/images/apps/outlook.png",
};

function isSystemSource(type: string, label: string): boolean {
  const normalizedType = type.toLowerCase();
  const normalizedLabel = label.toLowerCase();
  return (
    normalizedType === "manual" ||
    normalizedType === "system" ||
    normalizedLabel === "manual" ||
    normalizedLabel === "system"
  );
}

function getSourceLogo(type: string, label: string): string | null {
  if (isSystemSource(type, label)) return "/images/logo_tauri.png";

  const normalized = type.toLowerCase();
  const platformId =
    SOURCE_TO_PLATFORM[normalized] ??
    SOURCE_TO_PLATFORM[type] ??
    SOURCE_TO_PLATFORM[label.toLowerCase()] ??
    SOURCE_TO_PLATFORM[label];
  if (!platformId) return null;
  return PLATFORM_LOGO_MAP[platformId] ?? null;
}

function getSourceFallbackIcon(type: string, label: string): string {
  const key = type.toLowerCase();
  const labelKey = label.toLowerCase();
  const iconMap: Record<string, string> = {
    email: "mail",
    slack: "slack",
    wechat: "wechat",
    telegram: "telegram",
    whatsapp: "whatsapp",
    feishu: "chat-smile",
    lark: "chat-smile",
    dingtalk: "chat-smile",
    notion: "blocks",
    jira: "ticket",
    linear: "zap",
    file: "file_text",
    "google-drive": "cloud",
    web: "global",
    person: "user",
    calendar: "calendar",
    outlook: "mail",
  };
  return iconMap[key] || iconMap[labelKey] || "link";
}

export function FocusSourceIcon({
  source,
  variant,
  className,
}: {
  source: FocusSource;
  variant?: "default" | "danger";
  className?: string;
}) {
  const isDanger = variant === "danger";
  const logoSrc = getSourceLogo(source.type, source.label);
  const title = isSystemSource(source.type, source.label)
    ? "openloomi"
    : source.label;

  return (
    <span
      className={cn(
        "inline-flex size-[18px] items-center justify-center rounded-full",
        isDanger ? "bg-red-100/80" : "bg-muted/80",
        className,
      )}
      title={title}
    >
      {logoSrc ? (
        <Image
          src={logoSrc}
          alt={title}
          width={12}
          height={12}
          className="size-3"
        />
      ) : (
        <RemixIcon
          name={getSourceFallbackIcon(source.type, source.label)}
          size="size-[12px]"
          className="shrink-0 text-surface-foreground"
        />
      )}
    </span>
  );
}
