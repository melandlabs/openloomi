import { siteMetadata } from "@/lib/marketing/seo";
import type {
  MarketingEmailTemplateDefinition,
  MarketingLinkMap,
  TemplateBuildContext,
} from "./types";

const defaultLinks: MarketingLinkMap = {
  appHome: siteMetadata.appUrl,
  connectPlatform: `${siteMetadata.appUrl}/?page=profile`,
  watchTutorial: "https://www.youtube.com/watch?v=LDtJ6vfbobs",
  startSummary: siteMetadata.appUrl,
  viewTips: `${siteMetadata.marketingUrl}/docs`,
  upgrade: `${siteMetadata.appUrl}/?page=profile`,
  viewPricing: `${siteMetadata.appUrl}/?page=profile`,
  viewWeeklyDigest: `${siteMetadata.appUrl}`,
  inviteTeam: `${siteMetadata.appUrl}`,
  manageSubscription: `${siteMetadata.appUrl}/?page=profile`,
  support: `${siteMetadata.appUrl}/support`,
  feedback: `${siteMetadata.appUrl}/support`,
  community: `${siteMetadata.appUrl}/support`,
  reactivate: `${siteMetadata.appUrl}/?page=profile`,
  marketingHome: siteMetadata.marketingUrl,
  viewChangelog: `${siteMetadata.marketingUrl}/docs/changelog`,
};

export function resolveDefaultLinks(overrides?: Partial<MarketingLinkMap>) {
  return {
    ...defaultLinks,
    ...(overrides ?? {}),
  };
}

const templates: MarketingEmailTemplateDefinition[] = [
  {
    id: "welcome_day0",
    name: "Welcome Orientation",
    stage: "welcome",
    goal: "Welcome new users and guide them to connect their first channel.",
    subject: "Welcome to openloomi",
    previewText:
      "Your communication avatar—bringing order to conversations across all your platforms.",
    recommendedDelayHours: 0,
    buildContent: (ctx: TemplateBuildContext) => ({
      intro: [
        "Welcome to openloomi. We're glad you're here.",
        "openloomi brings all your conversations into one place—Telegram, WhatsApp, Gmail, Slack, Discord, and more. Here's what openloomi can do for you:",
      ],
      highlights: [
        {
          label: "One inbox, every platform",
          description:
            "See all your messages in one calm place. No more switching between apps.",
        },
        {
          label: "Summaries that matter",
          description: "Catch up on what matters in seconds, not hours.",
        },
        {
          label: "Smart replies, your tone",
          description:
            "AI drafts responses in your voice. Approve and send in one click.",
        },
        {
          label: "Daily recaps",
          description:
            "Start each day knowing exactly what needs your attention.",
        },
      ],
      sections: [
        {
          title: "Let's get started",
          paragraphs: [
            "Connect any messaging platform and openloomi will start organizing your conversations immediately.",
          ],
        },
      ],
      ctas: [
        {
          label: "Connect a platform",
          href: "connectPlatform",
          variant: "primary",
        },
        {
          label: "See how it works",
          href: "watchTutorial",
          variant: "secondary",
        },
      ],
      closing: [
        "Questions? Just hit reply—we're here to help.",
        "The openloomi Team",
      ],
    }),
  },
  {
    id: "activation_connect_day1",
    name: "Activation — Connect a Platform",
    stage: "activation",
    goal: "Encourage users to connect at least one messaging channel within 24 hours.",
    subject: "Connect Slack, Telegram, or Gmail to unlock openloomi",
    previewText:
      "It only takes 30 seconds to connect your first platform and see openloomi in action.",
    recommendedDelayHours: 24,
    buildContent: () => ({
      intro: [
        "You took the first step with openloomi, nice! Right now, your AI teammate is waiting to plug into your world.",
        "Once you connect a messaging platform, openloomi instantly starts triaging and summarizing the noise.",
      ],
      sections: [
        {
          title: "What unlocks when you connect?",
          paragraphs: [
            "The moment Telegram, WhatsApp, Gmail, Slack, or Discord is connected you'll get:",
          ],
          bullets: [
            "One unified inbox to monitor everything at a glance.",
            "Smart auto-summaries that prioritize what truly matters.",
            "Ask in plain language to get answers hidden in your messages.",
            "Generate and send replies without breaking your flow.",
            "Daily recaps that show open loops and pending replies.",
          ],
        },
      ],
      checklist: [
        "Pick the platform you check most often.",
        "Click connect and approve access.",
        "Let openloomi collect the last few days of history.",
      ],
      ctas: [
        {
          label: "Connect my platform now",
          href: "connectPlatform",
          variant: "primary",
        },
        {
          label: "Watch the 90-second setup tour",
          href: "watchTutorial",
          variant: "secondary",
        },
      ],
      closing: [
        "Need a hand or have security questions? Just reply—real humans from the openloomi team are on standby.",
      ],
    }),
  },
  {
    id: "activation_first_summary_day2",
    name: "Activation — Trigger First Summary",
    stage: "activation",
    goal: "Prompt the user to generate their first summary once a platform is connected.",
    subject: "✨ Ask openloomi for your first summary today",
    previewText:
      "Let openloomi show you what really matters—just ask for a daily recap.",
    recommendedDelayHours: 48,
    buildContent: () => ({
      intro: [
        "Great job linking a channel! Now it is time to see openloomi work for you in real time.",
      ],
      sections: [
        {
          title: "Try this quick prompt:",
          paragraphs: [
            'Open openloomi and ask, <strong>"Summarize what I missed today."</strong>',
            "In seconds you'll see:",
          ],
          bullets: [
            "Highlights from every important thread.",
            "Action items waiting on you.",
            "People who are expecting a reply.",
          ],
        },
        {
          title: "Pro tip",
          paragraphs: [
            "Save that prompt as a shortcut so you can run it every afternoon with one click.",
          ],
        },
      ],
      ctas: [
        {
          label: "Open openloomi & run my first summary",
          href: "startSummary",
          variant: "primary",
        },
      ],
      closing: [
        "Let us know how your first summary feels—every message helps us sharpen openloomi for you.",
      ],
    }),
  },
  {
    id: "education_value_day4",
    name: "Education — Value Proof",
    stage: "education",
    goal: "Highlight key value propositions and encourage deeper usage.",
    subject: "How openloomi saves you 2 hours every day 🌟",
    previewText:
      "Multiplying your focus starts with a few simple habits inside openloomi.",
    recommendedDelayHours: 96,
    buildContent: () => ({
      intro: [
        "You have already taken the right steps—now let’s show you how power users reclaim serious time with openloomi.",
      ],
      sections: [
        {
          title: "Where openloomi shines:",
          paragraphs: [],
          bullets: [
            "One calm inbox for Slack, Telegram, Gmail, WhatsApp, Discord, and more.",
            "Daily recaps that bubble up priorities, decisions, and loose threads.",
            "Plain language questions like “What did my boss say today?” that surface answers instantly.",
            "Save images, videos, and documents with one click—Basic gets 2 TB of encrypted storage, Pro expands to 5 TB.",
          ],
        },
        {
          title: "Adopt one ritual today",
          paragraphs: [
            "Set a recurring reminder to ask openloomi for a recap before you log off. The habit compounds quickly.",
          ],
        },
      ],
      ctas: [
        {
          label: "Jump back into openloomi",
          href: "appHome",
          variant: "primary",
        },
      ],
    }),
  },
  {
    id: "education_pro_tips_day6",
    name: "Education — Power Tips",
    stage: "education",
    goal: "Share workflow best practices to deepen daily engagement.",
    subject: "Pro tips: make openloomi work harder for you",
    previewText:
      "Pin openloomi, explore by event, and let auto-translate keep every thread flowing.",
    recommendedDelayHours: 144,
    buildContent: () => ({
      intro: [
        "Ready to go from curious to confident? Here are the rituals our most active users swear by.",
      ],
      sections: [
        {
          title: "Try these today:",
          paragraphs: [],
          bullets: [
            "Pin openloomi in your browser so it is one click away.",
            "Use event-based summaries to catch up after meetings or travel windows.",
            "Enable auto-translate to draft and respond fluently in any language.",
            "Glance at your daily recap to see open actions before they slip.",
            "Drop important attachments into openloomi - they stay available from any device, and you control who can download them.",
          ],
        },
      ],
      ctas: [
        {
          label: "Explore tips inside openloomi",
          href: "viewTips",
          variant: "primary",
        },
        {
          label: "Share feedback or requests",
          href: "feedback",
          variant: "secondary",
        },
      ],
    }),
  },
  {
    id: "education_keep_active_day9",
    name: "Education — Keep Momentum",
    stage: "education",
    goal: "Encourage consistent usage and highlight adaptive learning.",
    subject: "Keep the habit—openloomi learns with you",
    previewText:
      "The more you lean on openloomi, the smarter your summaries and auto-replies become.",
    recommendedDelayHours: 216,
    buildContent: () => ({
      intro: [
        "Every interaction teaches openloomi what matters to you—topics, tone, and the people you prioritize.",
      ],
      sections: [
        {
          title: "Stay in flow by:",
          paragraphs: [],
          bullets: [
            "Favoriting people or channels you never want to miss.",
            "Tagging tasks with urgency so openloomi escalates them automatically.",
            "Replying from openloomi when you approve a draft—your style gets sharper each time.",
          ],
        },
      ],
      ctas: [
        {
          label: "Open openloomi and review today's queue",
          href: "appHome",
          variant: "primary",
        },
      ],
      closing: [
        "We would love to hear how openloomi is landing in your workflow—reply with anything that would make it even better.",
      ],
    }),
  },
  {
    id: "reinforcement_progress_day14",
    name: "Reinforcement — Progress Recap",
    stage: "reinforcement",
    goal: "Celebrate streaks and showcase value to maintain engagement.",
    subject: "Look at your openloomi streak 🙌",
    previewText:
      "Seven active days unlock richer insights—here is how to keep momentum.",
    recommendedDelayHours: 336,
    buildContent: (ctx) => ({
      intro: [
        "Consistency pays off—openloomi now has enough context to surface deeper insights tailored to you.",
      ],
      sections: [
        {
          title: "What openloomi has learned so far",
          paragraphs: [
            "Based on your recent activity, openloomi is prioritizing:",
          ],
          bullets: [
            "People you collaborate with most often.",
            "Topics and projects that stay open longer than a day.",
            "Moments where you typically need a quick reply draft.",
          ],
        },
        {
          title: "Double down on the wins",
          paragraphs: [
            "Bookmark your weekly digest and share it with your team so everyone stays aligned.",
            "Schedule a Friday recap to wrap the week without chasing every thread manually.",
          ],
        },
      ],
      ctas: [
        {
          label: "Invite a teammate",
          href: "inviteTeam",
          variant: "secondary",
        },
      ],
      closing: [
        "Thanks for letting openloomi ride shotgun in your comms. Tell us what else you want to automate next—we build from your ideas.",
      ],
    }),
  },
  {
    id: "reinforcement_advanced_day21",
    name: "Reinforcement — Advanced Features",
    stage: "reinforcement",
    goal: "Introduce advanced features to power users.",
    subject: "Unlock advanced openloomi workflows",
    previewText:
      "Turn on advanced automations and approval flows to supercharge your inbox.",
    recommendedDelayHours: 504,
    buildContent: () => ({
      intro: [
        "You are officially in the openloomi power lane. Ready to automate even more?",
      ],
      sections: [
        {
          title: "Advanced workflows waiting for you:",
          paragraphs: [],
          bullets: [
            "Auto-route VIP mentions into instant summaries.",
            "Set escalation rules so openloomi pings you only when action is required.",
            "Export recaps into Notion or Google Docs for team visibility.",
          ],
        },
        {
          title: "Need a tailored walkthrough?",
          paragraphs: [
            "Schedule 15 minutes with our product specialists—we will tune openloomi to your stack live.",
          ],
        },
      ],
      ctas: [
        {
          label: "Read the latest changelog",
          href: "viewChangelog",
          variant: "secondary",
        },
      ],
    }),
  },
  {
    id: "conversion_limit_reached",
    name: "Conversion — Free Limit Approaching",
    stage: "conversion",
    goal: "Alert free users nearing usage limits and prompt upgrade.",
    subject: "You are approaching the free openloomi limit",
    previewText:
      "Upgrade now to keep summaries refreshing instantly and unlock premium automations.",
    recommendedDelayHours: 0,
    buildContent: () => ({
      intro: [
        "Great news—your team is leaning on openloomi heavily. You are nearly at the free plan ceiling and we do not want momentum to stall.",
      ],
      sections: [
        {
          title: "Upgrade to openloomi Pro to unlock:",
          paragraphs: [],
          bullets: [
            "Unlimited integrations and accounts.",
            "Trained on your long-term conversations—it understands you from day one.",
            "Abundant insights and reply drafts across every connected channel.",
            "Priority refresh speeds plus customized digest scheduling.",
            "Advanced automations, approval workflows, and analytics dashboards.",
          ],
        },
        {
          title: "Bonus: lock today’s pricing",
          paragraphs: [
            "Upgrade within 48 hours and we will honor your current usage tier for the next year.",
          ],
        },
      ],
      ctas: [
        {
          label: "Upgrade to openloomi Pro",
          href: "upgrade",
          variant: "primary",
        },
        {
          label: "Compare plans",
          href: "viewPricing",
          variant: "secondary",
        },
      ],
    }),
  },
  {
    id: "conversion_roi_proof",
    name: "Conversion — ROI Stories",
    stage: "conversion",
    goal: "Share ROI and testimonials to motivate upgrades.",
    subject: "See how teams 3x their output with openloomi Pro",
    previewText:
      "Real users reclaim 10+ hours a week once they unlock Pro automations.",
    recommendedDelayHours: 24,
    buildContent: () => ({
      intro: [
        "Curious how openloomi Pro performs in the wild? Here is what operations leaders and chiefs of staff report after upgrading.",
      ],
      sections: [
        {
          title: "Customer snapshots",
          paragraphs: [],
          bullets: [
            "Global sales lead → closes deals 2× faster by unifying client chats and follow-ups in one smart inbox.",
            "Remote ops team → reduced message triage time by 68% with daily digests and approvals.",
            "Customer support lead → deflected 40% of repetitive replies using multilingual auto-drafts.",
            "Community manager → turns chaos into insight with auto-clustered discussions and sentiment highlights.",
            "Founder on the go → never misses executive updates thanks to VIP escalation rules.",
            "Busy professional → regains focus through daily message digests and smart summaries across all platforms.",
          ],
        },
      ],
      checklist: [
        "Need procurement docs? We can share them same day.",
        "Have a security questionnaire? Reply and we will send the latest package.",
      ],
      ctas: [
        {
          label: "Upgrade instantly",
          href: "upgrade",
          variant: "secondary",
        },
      ],
    }),
  },
  {
    id: "conversion_limited_offer",
    name: "Conversion — Limited Offer",
    stage: "conversion",
    goal: "Create urgency with a time-bound incentive.",
    subject: "24 hours left: lock openloomi Pro with bonus support",
    previewText:
      "Upgrade now and get dedicated onboarding plus an extended trial window.",
    recommendedDelayHours: 48,
    buildContent: () => ({
      intro: [
        "Final nudge! Upgrade in the next 24 hours and we will unlock concierge onboarding for your team at no extra cost.",
      ],
      sections: [
        {
          title: "Your upgrade bonus includes:",
          paragraphs: [],
          bullets: [
            "Hands-on setup session to map your channels and approval flows.",
            "Extended 30-day refund window so you can trial Pro features with zero risk.",
            "Priority access to roadmap previews and alpha features.",
          ],
        },
      ],
      ctas: [
        {
          label: "Upgrade before the window closes",
          href: "upgrade",
          variant: "primary",
        },
        {
          label: "Ask a question first",
          href: "support",
          variant: "secondary",
        },
      ],
      closing: [
        "We are excited to keep building alongside you. Reply if you need an invoice or purchase order instead.",
      ],
    }),
  },
  {
    id: "weekly_digest_default",
    name: "Weekly Digest",
    stage: "weekly_digest",
    goal: "Share a weekly recap to reinforce habit and highlight insight.",
    subject: "Your openloomi weekly recap is ready",
    previewText:
      "Highlights, completed to-dos, and what needs your focus next week.",
    recommendedDelayHours: 168,
    buildContent: () => ({
      intro: [
        "Here is what openloomi monitored, summarized, and surfaced for you this past week.",
      ],
      sections: [
        {
          title: "Ask openloomi about Your Weekly highlights",
          paragraphs: ["Your personalized digest includes:"],
          bullets: [
            "Top threads and decisions that moved projects forward.",
            "Open follow-ups that still need your voice.",
            "People who received the most attention from you and your team.",
          ],
        },
        {
          title: "Next week at a glance",
          paragraphs: [
            "Review the upcoming commitments and recommended focus areas so Monday feels calm, not chaotic.",
          ],
        },
      ],
      ctas: [
        {
          label: "Open my weekly digest",
          href: "viewWeeklyDigest",
          variant: "primary",
        },
        {
          label: "Share with my team",
          href: "inviteTeam",
          variant: "secondary",
        },
      ],
      closing: [
        "Want to tailor what shows up in the digest? Reply and we will help you configure filters or custom focus lists.",
      ],
    }),
  },
  {
    id: "product_updates_feature_drop",
    name: "Product Updates",
    stage: "product_updates",
    goal: "Inform users about new features and drive adoption.",
    subject:
      "New in openloomi: personalized insights, long-term memory, smart file storage, and fresh integrations",
    previewText:
      "Catch this month’s feature drops and watch quick demos to put them to work.",
    recommendedDelayHours: 0,
    buildContent: () => ({
      intro: [
        "We shipped a handful of improvements to keep your conversations tighter and your team in sync.",
      ],
      sections: [
        {
          title: "What is new:",
          paragraphs: [],
          bullets: [
            "Live personalized insights refresh every minute for Priority channels.",
            "Your second brain that remembers what—and who—matters, just for you.",
            "Attachments from Slack, Telegram, Gmail, and more now appear directly in Understanding detail—no extra AI agent handoff required.",
            "One-click save important files from any conversation and analyze them anytime.",
            "New integrations: WhatsApp, Discord, RSS feed and shared inbox support.",
          ],
        },
        {
          title: "See them in action",
          paragraphs: [
            "We recorded quick demos so you can adopt the updates in under five minutes.",
          ],
          bullets: [
            "Priority channels walkthrough → watch now.",
            "File storage tour → see how it works.",
            "Discord integration setup → step-by-step guide.",
          ],
        },
      ],
      ctas: [
        {
          label: "Watch the update demos",
          href: "watchTutorial",
          variant: "primary",
        },
        {
          label: "Read the full changelog",
          href: "viewChangelog",
          variant: "secondary",
        },
      ],
      closing: [
        "Have something we should build next? Reply with your idea—we prioritize the roadmap based on power-user feedback.",
      ],
    }),
  },
  {
    id: "upgrade_prompt_capacity",
    name: "Upgrade Prompt — Capacity",
    stage: "upgrade_prompt",
    goal: "Encourage paying customers to move up a tier when they hit limits.",
    subject: "Running into limits? Scale openloomi with a larger plan",
    previewText:
      "Add more seats, channels, or refresh capacity in just a few clicks.",
    recommendedDelayHours: 0,
    buildContent: () => ({
      intro: [
        "We noticed you are maxing out the capacity on your current plan—great signal that openloomi is embedded in your workflow.",
      ],
      sections: [
        {
          title: "Upgrade to keep everyone moving:",
          paragraphs: [],
          bullets: [
            "Add more integrations and credits without juggling which ones stay synced.",
            "Increase refresh frequency so leaders see updates in real time.",
            "Extended learning and memory—your digital twin truly understands you.",
          ],
        },
      ],
      ctas: [
        {
          label: "View higher-tier plans",
          href: "manageSubscription",
          variant: "primary",
        },
      ],
      closing: [
        "Need a tailored quote or procurement paperwork? Reply and we will send it over same-day.",
      ],
    }),
  },
  {
    id: "upgrade_prompt_refresh_rate",
    name: "Upgrade Prompt — Refresh Rate",
    stage: "upgrade_prompt",
    goal: "Encourage upgrades for faster refresh cadence and automations.",
    subject: "Need faster openloomi refreshes? Let’s unlock them",
    previewText:
      "Upgrade to boost summary frequency, automation slots, and reporting.",
    recommendedDelayHours: 72,
    buildContent: () => ({
      intro: [
        "Your team is moving fast—which means you deserve faster openloomi updates.",
      ],
      sections: [
        {
          title: "What an upgrade unlocks:",
          paragraphs: [],
          bullets: [
            "1-minute refresh cadence for high-priority channels.",
            "Expanded automation for personalized insights and actions.",
            "Advanced analytics to track response times and sentiment.",
          ],
        },
      ],
      ctas: [
        {
          label: "Upgrade my refresh speed",
          href: "manageSubscription",
          variant: "primary",
        },
      ],
      closing: [
        "Not sure which plan is right? Reply and we will recommend the perfect tier based on your usage.",
      ],
    }),
  },
  {
    id: "renewal_day_7",
    name: "Renewal Reminder — 7 Days",
    stage: "renewal",
    goal: "Remind customers of upcoming renewal with value reinforcement.",
    subject: "Your openloomi subscription renews in 7 days",
    previewText:
      "Keep auto-summaries, digests, and approvals running without interruption.",
    recommendedDelayHours: 0,
    buildContent: () => ({
      intro: [
        "Quick heads up—your openloomi subscription renews in one week. We want to make sure nothing interrupts your automations.",
      ],
      sections: [
        {
          title: "Here is what you keep active:",
          paragraphs: [],
          bullets: [
            "Ample insights, memory and learning across every connected platform.",
            "Your digital twin thinks and responds as you would.",
            "Historical insights plus searchable context and files across your whole team.",
          ],
        },
      ],
      ctas: [
        {
          label: "Review my plan",
          href: "manageSubscription",
          variant: "primary",
        },
      ],
      closing: [
        "Need an updated invoice, PO, or vendor form? Reply and we will handle it right away.",
      ],
    }),
  },
  {
    id: "renewal_day_3",
    name: "Renewal Reminder — 3 Days",
    stage: "renewal",
    goal: "Increase urgency as renewal approaches.",
    subject: "3 days left—keep openloomi superpowers active",
    previewText:
      "React now to avoid losing access to the automations your team relies on.",
    recommendedDelayHours: 96,
    buildContent: () => ({
      intro: [
        "You are three days from renewal. Let’s make sure your openloomi automations keep running without disruption.",
      ],
      sections: [
        {
          title: "Why teams stay active:",
          paragraphs: [],
          bullets: [
            "Auto-replies that match your tone across every channel.",
            "Proactive alerts when key stakeholders need a response.",
            "Trusted security posture with encryption and audit logs.",
          ],
        },
      ],
      ctas: [
        {
          label: "Confirm my renewal",
          href: "manageSubscription",
          variant: "primary",
        },
      ],
      closing: [
        "If you need to adjust seats, billing frequency, or payment method just reply—we will sort it for you.",
      ],
    }),
  },
  {
    id: "renewal_final_day",
    name: "Renewal Reminder — Final Day",
    stage: "renewal",
    goal: "Drive last-day renewals with urgent CTA.",
    subject: "Final reminder: renew openloomi today",
    previewText:
      "Avoid downtime—renew now or tell us how we can help make it easy.",
    recommendedDelayHours: 144,
    buildContent: () => ({
      intro: [
        "This is the final reminder—your openloomi subscription expires tonight. Renew now to prevent any pauses in service.",
      ],
      sections: [
        {
          title: "Still evaluating?",
          paragraphs: [
            "If something is holding you back, hit reply and let us know. We are happy to:",
          ],
          bullets: [
            "Offer an extension while procurement wraps up.",
            "Adjust your plan to match new headcount.",
            "Jump on a quick call to answer outstanding questions.",
          ],
        },
      ],
      ctas: [
        {
          label: "Renew openloomi now",
          href: "manageSubscription",
          variant: "primary",
        },
        {
          label: "Request an extension",
          href: "support",
          variant: "secondary",
        },
      ],
    }),
  },
  {
    id: "loyalty_community_invite",
    name: "Loyalty — Community Invite",
    stage: "loyalty",
    goal: "Invite long-term customers into community and feedback loop.",
    subject: "Join the openloomi power user circle",
    previewText:
      "Get sneak peeks, share feedback, and connect with workflow experts.",
    recommendedDelayHours: 0,
    buildContent: () => ({
      intro: [
        "You have been with openloomi for over a month—we could not be more grateful. We would love to bring you into our private community.",
      ],
      sections: [
        {
          title: "Inside the openloomi circle you will find:",
          paragraphs: [],
          bullets: [
            "Early access to upcoming features and roadmap previews.",
            "Workflow breakdowns from other operations leaders.",
            "Direct feedback channels with our product, design, and engineering teams.",
          ],
        },
      ],
      ctas: [
        {
          label: "Join the community",
          href: "community",
          variant: "primary",
        },
        {
          label: "Share feedback with product",
          href: "feedback",
          variant: "secondary",
        },
      ],
      closing: [
        "Thank you for helping build the future of calm, AI-powered communication. We cannot wait to hear what you think next.",
      ],
    }),
  },
  {
    id: "loyalty_teams_referral",
    name: "Loyalty — Team Expansion",
    stage: "loyalty",
    goal: "Encourage referrals and team expansion.",
    subject: "Invite your team—amplify openloomi across the org",
    previewText:
      "Share openloomi with your colleagues and keep everyone aligned automatically.",
    recommendedDelayHours: 168,
    buildContent: () => ({
      intro: [
        "Ready to multiply the calm across your team? openloomi is even more powerful when everyone shares the same source of truth.",
      ],
      sections: [
        {
          title: "Organizations love openloomi because it:",
          paragraphs: [],
          bullets: [
            "Keeps exec, ops, and support teams in a single AI-prioritized inbox.",
            "Provides instant recaps after meetings or shifts change.",
            "Generates consistent replies that match brand voice across channels.",
          ],
        },
      ],
      ctas: [
        {
          label: "Invite teammates",
          href: "inviteTeam",
          variant: "primary",
        },
      ],
      closing: [
        "Refer a team and let us know—we love sending thank-you swag to power users like you.",
      ],
    }),
  },
  {
    id: "winback_week",
    name: "Winback — 7 Day Trigger",
    stage: "winback",
    goal: "Re-engage users inactive for 7 days.",
    subject: "We saved your week—come see the highlights",
    previewText:
      "openloomi kept listening. Open your recap and jump back in without the overwhelm.",
    recommendedDelayHours: 0,
    buildContent: () => ({
      intro: [
        "We noticed it has been a little while since you last checked openloomi. No worries—we continued to summarize and triage in the background.",
      ],
      sections: [
        {
          title: "Here is what you missed:",
          paragraphs: ["Your latest digest includes:"],
          bullets: [
            "Prioritized threads that need your attention.",
            "Unanswered mentions and action items waiting on you.",
            "Summaries of conversations from the last week.",
          ],
        },
      ],
      ctas: [
        {
          label: "Open my catch-up recap",
          href: "reactivate",
          variant: "primary",
        },
        {
          label: "Need to tweak notifications?",
          href: "support",
          variant: "secondary",
        },
      ],
      closing: [
        "If something felt off or noisy, reply and tell us—we will tune openloomi so your next login feels perfect.",
      ],
    }),
  },
  {
    id: "winback_two_weeks",
    name: "Winback — 14 Day Trigger",
    stage: "winback",
    goal: "Offer incentive or support to re-engage dormant users.",
    subject: "Still quiet? Let’s reboot openloomi with a fresh start",
    previewText:
      "We will refresh your inbox and extend your trial so you can feel the impact again.",
    recommendedDelayHours: 168,
    buildContent: () => ({
      intro: [
        "It has been a couple of weeks since we saw you in openloomi. We would love to welcome you back with a clean slate.",
      ],
      sections: [
        {
          title: "Here is what we can do for you right now:",
          paragraphs: [],
          bullets: [
            "Extend your trial or add bonus credits so you can explore without limits.",
            "Jump on a quick call to reconfigure summaries and alerts.",
            "Share a bespoke recap of the most important updates since you left.",
          ],
        },
      ],
      ctas: [
        {
          label: "Reactivate my account",
          href: "reactivate",
          variant: "primary",
        },
        {
          label: "Request extra help",
          href: "support",
          variant: "secondary",
        },
      ],
      closing: [
        "Reply with whatever would make openloomi valuable for you again—we are listening and ready to help.",
      ],
    }),
  },
];

export const MARKETING_EMAIL_TEMPLATES = templates;

const templateMap = new Map<string, MarketingEmailTemplateDefinition>(
  templates.map((template) => [template.id, template]),
);

export function getMarketingTemplateById(id: string) {
  return templateMap.get(id);
}
