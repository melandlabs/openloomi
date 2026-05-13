import { RemixIcon } from "@/components/remix-icon";
import Image from "next/image";

const getIntegrationIcon = (platform: string, size = "size-4") => {
  switch (platform?.toLowerCase()) {
    case "slack":
      return (
        <Image
          src="/images/apps/slack.png"
          alt="slack"
          width={24}
          height={24}
          className={size}
        />
      );
    case "discord":
      return (
        <Image
          src="/images/apps/discord.png"
          alt="discord"
          width={24}
          height={24}
          className={size}
        />
      );
    case "telegram":
    case "tg":
      return (
        <Image
          src="/images/apps/telegram.png"
          alt="telegram"
          width={24}
          height={24}
          className={size}
        />
      );
    case "gmail":
      return (
        <Image
          src="/images/apps/gmail.png"
          alt="gmail"
          width={24}
          height={24}
          className={size}
        />
      );
    case "outlook":
      return (
        <Image
          src="/images/apps/outlook.png"
          alt="outlook"
          width={24}
          height={24}
          className={size}
        />
      );
    case "google_calendar":
    case "gcal":
      return (
        <Image
          src="/images/apps/google_calendar.png"
          alt="google calendar"
          width={24}
          height={24}
          className={size}
        />
      );
    case "outlook_calendar":
      return (
        <Image
          src="/images/apps/outlook_calendar.png"
          alt="Outlook Calendar"
          width={24}
          height={24}
          className={size}
        />
      );
    case "whatsapp":
      return (
        <Image
          src="/images/apps/whatsapp.png"
          alt="whatsapp"
          width={24}
          height={24}
          className={size}
        />
      );
    case "facebook_messenger":
    case "messenger":
      return (
        <Image
          src="/images/apps/facebook_messenger.png"
          alt="Facebook Messenger"
          width={24}
          height={24}
          className={size}
        />
      );
    case "linkedin":
      return (
        <Image
          src="/images/apps/linkedin.png"
          alt="LinkedIn"
          width={24}
          height={24}
          className={size}
        />
      );
    case "instagram":
      return (
        <Image
          src="/images/apps/Instagram.png"
          alt="Instagram"
          width={24}
          height={24}
          className={size}
        />
      );
    case "twitter":
    case "x":
      return (
        <Image
          src="/images/apps/twitter.png"
          alt="X"
          width={24}
          height={24}
          className={size}
        />
      );
    case "google_drive":
    case "google-drive":
      return <RemixIcon name="cloud" size={size} />;
    case "google_docs":
    case "google-docs":
      return (
        <Image
          src="/images/apps/google_docs.png"
          alt="Google Docs"
          width={24}
          height={24}
          className={size}
        />
      );
    case "hubspot":
      return (
        <Image
          src="/images/apps/hubspot.png"
          alt="HubSpot"
          width={24}
          height={24}
          className={size}
        />
      );
    case "notion":
      return (
        <Image
          src="/images/apps/notion.png"
          alt="notion"
          width={24}
          height={24}
          className={size}
        />
      );
    case "github":
      return (
        <Image
          src="/images/apps/github.png"
          alt="GitHub"
          width={24}
          height={24}
          className={size}
        />
      );
    case "asana":
      return (
        <Image
          src="/images/apps/asana.png"
          alt="Asana"
          width={24}
          height={24}
          className={size}
        />
      );
    case "teams":
      return (
        <Image
          src="/images/apps/teams.png"
          alt="teams"
          width={24}
          height={24}
          className={size}
        />
      );
    case "dingtalk":
      return (
        <Image
          src="/images/apps/DingTalk.png"
          alt="DingTalk"
          width={24}
          height={24}
          className={size}
        />
      );
    case "jira":
      return <RemixIcon name="circle_check" size={size} />;
    case "google_meetings":
    case "google-meetings":
    case "meeting":
      return <RemixIcon name="video" size={size} />;
    case "manual":
      return (
        <Image
          src="/images/apps/default.png"
          alt="openloomi"
          width={24}
          height={24}
          className={size}
        />
      );
    case "note":
    case "notes":
      return <RemixIcon name="file_text" size={size} />;
    case "imessage":
    case "i-message":
    case "imsg":
      return (
        <Image
          src="/images/apps/iMessage.png"
          alt="iMessage"
          width={24}
          height={24}
          className={size}
        />
      );
    case "rss":
      return (
        <Image
          src="/images/apps/rss.png"
          alt="RSS"
          width={24}
          height={24}
          className={size}
        />
      );
    case "weixin":
    case "wechat":
      return (
        <Image
          src="/images/apps/WeChat.png"
          alt="Weixin"
          width={24}
          height={24}
          className={size}
        />
      );
    default:
      /* AI-generated or unknown channels (e.g., "Project", "openloomi") use default icon */
      return (
        <Image
          src="/images/apps/default.png"
          alt=""
          width={24}
          height={24}
          className={size}
        />
      );
  }
};

export default function IntegrationIcon({
  platform,
  size = "size-4",
}: {
  platform: string;
  size?: string;
}) {
  return getIntegrationIcon(platform, size);
}
