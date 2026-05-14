---
name: openloomi-feature-guide
description: "Use this when users ask about openloomi features, capabilities, or how to use it. Examples: 'openloomi 怎么用', '你能做什么', 'What can you do?', 'How does openloomi work?', 'Tell me about openloomi features', 'What platforms does openloomi support?', 'How do I use scheduled tasks?', 'What is Insights system?', 'How do I connect Telegram?', 'How to create automation?', '什么是 openloomi 事件?'
metadata:
  version: 0.5.0
---

# openloomi Product Features

Use this skill when users ask about openloomi features, usage, or capabilities. Provide accurate and easy-to-understand feature introductions and operation guides.

---

## What is openloomi

openloomi is a **Proactive AI Workspace** that understands your intent, orchestrates execution, and gets things done. It's not just another AI assistant—it's an innovative AI product that **senses business signals**, **orchestrates tasks autonomously**, and **tracks and validates results end-to-end**.

### Core Value Proposition

openloomi transforms how individuals and SMB teams work by:
- **Proactive Awareness** — Monitors signals across platforms and alerts you before you ask
- **Long-Term Memory** — Remembers context across months, never forgets commitments
- **Autonomous Execution** — Not just telling you what to do, but doing it
- **200+ Skills** — Rich execution capabilities for every work scenario

---

## Core Capabilities

### 🧠 Long-Term Memory
Clear recollection, never forgotten. openloomi builds persistent knowledge graphs that remember all important people, events, decisions, and context across sessions and time. Six months later, it still knows your commitments and preferences.

### 🎯 Noise Filtering
Tells you what you should act on. With hundreds of daily messages, openloomi replaces "information overload" with "priority signals." Filters 95% of noise, focusing your attention on the 5% that truly matters.

### ⚡ Powerful Engine
Intent understanding, automatic orchestration. When you say "Help me prepare an investor pitch," openloomi automatically understands intent, breaks it into multiple sub-tasks, invokes appropriate Skills, and chains execution.

### 🔐 Security & Privacy
Your data, your sovereignty. Local-first architecture—your raw data never leaves your device. End-to-end AES-256 encryption, zero-data-training commitment, SOC 2 compliance audit.

### 🛠️ 200+ Skills
200+ Skills covering every work scenario, continuously expanding:
- 📊 Data Analysis
- 💻 Code Generation
- 📄 Document Creation
- 🌐 Web Automation
- 🎨 Image Generation
- 📧 Email Writing
- 🔍 Deep Research
- 📊 PPT Creation
- +200 more skills...

---

## Use Cases

### 🌍 Global Managers
Never miss a critical signal across time zones. Business runs 24/7 globally. openloomi filters time zone and language noise, capturing high-value opportunities while you sleep—wake up to a refined action list.

### 🧑‍💻 Engineers & Product Teams
Team memory that never decays. Transform discussions scattered across Slack, Jira, and documents into structured knowledge. Auto-generate weekly reports, sync missed context, eliminate "context rot."

### 🚀 Founders & Sales
One person does the work of many, at scale. openloomi learns your communication style, automatically maintains hundreds of client relationships, follows up on leads, generates personalized proposals—never burns out.

---

## Quick Start

### 1. Sign Up / Sign In

- Sign up with email and password
- Or sign in directly with your **Google** or **GitHub** account

### 2. Onboarding

First-time users will go through an onboarding flow:
1. Select your role and focus areas
2. Tell openloomi what you'd like it to help with
3. Connect platforms to unlock deeper insights
4. Name your AI assistant

### 3. Connect Communication Platforms

Click **[Connect platform]** to complete authorization.

**Supported platforms:**
- **Messaging**: Slack, Telegram, Discord, WhatsApp, Weixin, iMessage, QQ, Feishu, DingTalk
- **Email**: Gmail, Outlook
- **Social Media**: X (Twitter) — for marketing and content automation
- **Other**: RSS
- **Coming Soon**: Google Drive, Microsoft Teams, Notion, HubSpot, Google Calendar

---

## Platform Connection Steps

### WhatsApp

1. Click **[Connect WhatsApp]**
2. Complete authorization via **QR code scan** or **phone pair code**
3. Once authorized, openloomi will automatically read your WhatsApp messages to generate long-term events. You can send messages in **"Starred Messages"** and AI will:

- Read and understand your message content
- Generate smart insights in openloomi
- You can converse with AI about these messages in openloomi

> 💡 How to use: Open "Starred Messages" in WhatsApp, send a message to yourself, and AI will automatically read and understand it.

### Weixin

1. Click **[Connect Weixin]**
2. Complete authorization via **QR code scan**

### Telegram

1. Click **[Connect Telegram]** to enter the authorization page in the source settings.
2. Choose a login method:
   - **Phone verification**: Enter phone number → receive verification code → enter 2FA password if enabled
   - **QR code**: Scan QR code with Telegram → enter 2FA password if enabled
   - **Quick login**: If you have the official Telegram desktop app installed locally, you can use your existing session to log in without phone number or verification code
3. Once authorized, openloomi will automatically read your Telegram messages to generate long-term events on the Today page. You can send messages in **"Saved Messages"** and AI will:

- Read and understand your message content
- Generate smart insights in openloomi
- You can converse with AI about these messages in openloomi

> 💡 How to use: Open "Saved Messages" in Telegram, send a message to your saved messages, and AI will automatically read and understand it.

### Slack

1. Click **[Connect Slack]** in the integration settings
2. Click **[Install openloomi]** on the authorization page to add to your workspace
3. Note: Currently only workspace owners can install

### Discord

1. Click **[Connect Discord]** in the integration settings
2. Select the Discord server to install
3. Grant openloomi bot message permissions
4. Note: Only server admins can install

### Gmail

1. Click **[Connect Gmail]** in the integration settings
2. Enter the email address and app password to authorize

### RSS

1. Click **[RSS]** button to enter the RSS integration page
2. Enter a single RSS link, or upload an OPML file for batch import

### Feishu

1. Click **[Connect Feishu]**
2. Enter your Feishu App ID and App Secret
3. Click connect

**How to get credentials:**
1. Go to [Feishu Open Platform](https://open.feishu.cn/)
2. Create an enterprise self-built app
3. Enable bot capability
4. Select "Use long connection to receive events"
5. Subscribe to `im.message.receive_v1`
6. Get App ID and App Secret from the app settings

**Required permissions (scopes):**

```json
{
  "scopes": {
    "tenant": [
      "aily:file:read",
      "aily:file:write",
      "application:application.app_message_stats.overview:readonly",
      "application:application:self_manage",
      "application:bot.menu:write",
      "cardkit:card:write",
      "contact:user.employee_id:readonly",
      "corehr:file:download",
      "docs:document.content:read",
      "event:ip_list",
      "im:chat",
      "im:chat.access_event.bot_p2p_chat:read",
      "im:chat.members:bot_access",
      "im:message",
      "im:message.group_at_msg:readonly",
      "im:message.group_msg",
      "im:message.p2p_msg:readonly",
      "im:message:readonly",
      "im:message:send_as_bot",
      "im:resource",
      "sheets:spreadsheet",
      "wiki:wiki:readonly"
    ],
    "user": [
      "aily:file:read",
      "aily:file:write",
      "im:chat.access_event.bot_p2p_chat:read",
      "im:chat:read",
      "im:chat:readonly"
    ]
  }
}
```

### X (Twitter)

Connect X (Twitter) to enable marketing automation features.

1. Click **[Connect X]** to authorize via OAuth

### Outlook

1. Click **[Connect Gmail]** in the integration settings
2. Enter the email address and app password to authorize

### Microsoft Teams

Coming soon!

### QQBot

1. Click **[Connect QQ]**
2. Enter your QQ App ID and App Secret
3. Click connect

**How to get credentials:**
1. Go to [QQ Open Platform](https://q.qq.com/)
2. Create a bot
3. Get App ID and App Secret from the bot settings

### DingTalk

DingTalk integration uses a **Stream mode bot** — a long-lived WebSocket connection with no public IP or domain required.

**Before you start — create a DingTalk app:**

1. Go to [DingTalk Open Platform](https://open.dingtalk.com/) and sign in
2. Create an **enterprise internal app**
3. Add the **Bot** capability and choose **Stream mode** (long connection)
4. Copy your **Client ID (AppKey)** and **Client Secret (AppSecret)**

**Connect in openloomi:**

1. Click **[Connect DingTalk]**
2. Enter your **Client ID (AppKey)** and **Client Secret (AppSecret)**
3. Click **Connect**

> 💡 Stream mode means openloomi connects directly via WebSocket — no server or domain setup needed.

### iMessage

iMessage integration is **only available on macOS**.

1. Click **[Connect iMessage]**
2. Grant the required permissions:
   - **Full Disk Access** - Required to read iMessage database
   - **Automation Permission** - Required to send messages
3. Enter a display name for your iMessage account
4. Click connect

**How to grant permissions:**
- Go to **System Settings > Privacy & Security > Full Disk Access**
- Add the running app (Terminal, Node, or openloomi)
- Restart the app after granting permissions

> 💡 Your message data stays on your local device. openloomi only reads recent messages when you use it to generate insights.

---

## Desktop App

openloomi also offers a **desktop app** (macOS, Linux, and Windows) that provides a native local experience.

### Download & Install

**Windows:**

1. Download the latest `.exe` installer from [GitHub Releases](https://github.com/melandlabs/openloomi/releases/latest)
2. Run the installer — if Windows SmartScreen shows a warning, click **"More info"** then **"Run anyway"**. This is normal for new applications without a long code-signing reputation; openloomi is open-source and the code is publicly verifiable
3. After the first run, SmartScreen typically bypasses automatically on subsequent updates

**Winget (Coming Soon):**

```
winget install openloomi.openloomi
```

> 💡 You only need to complete the SmartScreen step once per machine.

**macOS:**

Download the latest `.dmg` from [GitHub Releases](https://github.com/melandlabs/openloomi/releases/latest) and drag openloomi to your Applications folder.

**Linux:**

Download the latest `.AppImage` or `.deb` from [GitHub Releases](https://github.com/melandlabs/openloomi/releases/latest).

| Platform | Status | Installer |
|----------|--------|----------|
| macOS | ✅ Available | `.dmg` |
| Linux | ✅ Available | `.AppImage`, `.deb` |
| Windows | ✅ Available | `.exe` (Installer) |
| Winget | Coming Soon | — |

### Important: App Must Be Running

To use **MessageApp conversations** and **scheduled automation tasks** in the desktop app:
- The app must be **open and running**
- The computer must be **turned on and not in sleep mode**

If the desktop app is closed or the computer is asleep, conversations and scheduled tasks will **not** execute.

### Local Data Storage

All data in the desktop app — including messages, conversations, scheduled tasks, and settings — is stored **locally** on your device via SQLite. No app data is sent to or stored on cloud servers.

---

## Permissions

When you first launch openloomi, the system may ask for a few permissions. Each one has a specific purpose — and **you can decline any of them**. openloomi will continue to work; you'll just lose the feature that requires that permission.

> **Privacy note:** openloomi processes data locally on your machine. Message content is never sent to third-party servers without your consent. [See our Privacy Policy →](https://app.openloomi.ai/privacy)

### macOS

| Permission | What it lets openloomi do | Can I decline? |
|---|---|---|
| **Full Disk Access** | Read your iMessage history from the local database so openloomi can surface important conversations in your Event feed | Yes — iMessage sync will be skipped |
| **Automation** | Send iMessages on your behalf when you ask openloomi to reply or notify someone | Yes — you'll receive drafts instead of automatic sends |
| **Notifications** | Push alerts when important events are detected (urgent emails, mentions, deadlines) | Yes — check the app manually instead |

**How to grant or revoke:**

1. Open **System Settings → Privacy & Security**
2. Find the permission category (e.g., **Full Disk Access**, **Automation**, **Notifications**)
3. Toggle openloomi on or off

You can revisit these settings at any time.

### Windows

| Permission | What it lets openloomi do | Can I decline? |
|---|---|---|
| **Notifications** | Push alerts when important events are detected (urgent emails, mentions, deadlines) | Yes — check the app manually instead |

Windows SmartScreen may also show a one-time warning when running the installer. Click **"More info"** then **"Run anyway"** — this is normal for open-source software. You only need to do this once per machine.

### Linux

No special permissions are required on Linux. openloomi uses the standard desktop notification system (libnotify) to send alerts — if you have granted notification permissions to other apps, openloomi will use them automatically.

---

## Conversation Features

Just type your questions or requests in the chat box, and openloomi will help you find answers.

### Example Questions

```
• "What is openloomi"
• "How to use openloomi"
• "Summarize yesterday's to-dos"
• "Today's important news"
• "What are my contacts"
• "Randomly send 'Hello' to 3 contacts on Gmail"
• "What progress have we made with the XX project this past week?"
```

### Features

- **Project collaboration queries** - Ask about project progress
- **Weekly report generation** - Request weekly reports on all project progress
- **Web browsing** - Have openloomi browse for latest product info
- **New conversation creation** - Start new conversations around specific topics
- **History** - View conversation history
- **Source References** - See exactly which messages/conversations openloomi's answers come from, who was involved, and when they occurred
- **Artifacts** - openloomi can generate visual artifacts: mind maps, flowcharts, charts, roadmaps, surveys, and documents. Preview and interact with them directly in chat
- **File Analysis** - Upload files (PDF, images, etc.) in chat and ask openloomi to analyze, summarize, or extract information
- **Deep Dive** - For certain topics, continue exploring with follow-up questions, detail requests, or scope narrowing
- **Topic-Based Chats** - Create new conversations around specific topics, review past discussions, build persistent context over time

### Chat via Messaging Apps

You can also interact with openloomi directly through your connected messaging apps. Once connected, openloomi becomes your AI assistant within those platforms.

| Platform  | Status    | Features                    |
| --------- | --------- | --------------------------- |
| Telegram  | Available | Chat, reminders             |
| WhatsApp  | Available | Chat, reminders, notifications |
| Weixin    | Available | Chat                        |
| iMessage  | Available | Chat, reminders, notifications |
| QQ        | Available | Chat, commands, automation  |
| Feishu    | Available | Enterprise workflow, commands |
| DingTalk  | Available | Chat, enterprise workflow    |

After connecting (e.g., Telegram), just send a message to **Saved Messages** and openloomi will respond naturally.

---

## Action Features

openloomi can generate action items for various scenarios.

### How to View

1. Click the **Action** button in the event details
2. Or view in the unified **Action panel**

### Features

- **To-do display** - Show TODOs in the unified panel
- **Quick action suggestions** - openloomi suggests clickable quick actions
- **Detailed information** - Fill in sender, recipient, content and attachments
- **AI content generation/translation** - Auto-generate or translate content
- **Message replies** - Click reply button in understanding detail view, openloomi will generate a reply

---

## Smart Insights

openloomi automatically analyzes your conversations to extract valuable information.

### Automatically Extracted Content

- ✅ **To-dos** - Tasks to complete, deadlines
- 📈 **Project progress** - Status updates, milestones
- 🎯 **Important decisions** - Meeting decisions, key choices
- ⚠️ **Risk alerts** - Issues to watch out for
- 📅 **Timeline** - Event development脉络

### How to Use

1. **View** - Click on an event in the left menu
2. **Categorize** - Mark as: Urgent, Important, Monitor, Archive
3. **Add to-do** - Add tasks directly in the details
4. **Timeline** - View event development timeline

### Event Management

Events are automatically organized into groups based on their status:

- **Opportunities** - New events that need attention
- **In Progress** - Events you're currently working on
- **Waiting on Others** - Events pending response
- **Done** - Completed events

You can **drag and drop** events between groups to manually categorize them. You can also **multi-select** multiple events for bulk operations (Mark as Done, Archive, Delete).

### Event Detail

Click on any event card to open its detail view:
- **Event title and description** - Full context of the event
- **Related messages** - All conversation threads involved
- **Participants** - Everyone included in the event
- **Timeline** - Chronological activity log
- **Notes** - Add personal text notes for reference
- **Attachments** - Upload documents, PDFs, images to keep related materials in one place

### Event Conversation

You can **chat directly with any event** to ask questions and get AI insights within that context.

**Sample questions:**
- "What is this event about?"
- "Who are the key people involved?"
- "What decisions were made?"

### Event Actions

- **Source Reply** - Reply directly to messages within an event. Use **AI suggestions** to generate a reply based on conversation context, or use **AI Translation** to translate to English or Chinese
- **AI Polishing** - Improve grammar, wording, and tone (formal, casual, friendly)
- **Send to Platform** - Send your reply directly to the original platform (Telegram, Discord, etc.)

### Common Queries

```
"What's on my to-do list today?"
"How is the XX project progressing?"
"What important messages were there last week?"
```

---

## Settings

> **How to access**: Click the settings button in the profile panel

### Soul

Define your AI assistant's personality and communication style.

### Description

Customize how your AI assistant describes itself to others.

### Contexts

Configure which data sources and contexts your AI assistant can access. Context types include:
- **System** - System notifications and status updates
- **Event** - Grouped communications and projects
- **Scheduled Task** - Time-based tasks and reminders
- **Knowledge** - Uploaded documents and reference materials

You can also create **custom context tabs** with your own name, description, icon, color, and priority. Use keywords to enable automatic categorization.

### Interests

Customize what to follow — specific people or topics/projects. For each, you can set:
- **Notification Level**: All messages, Only @me, or Nothing
- **AI Summary**: Enable AI-generated summaries of their messages
- **Auto-archive**: Automatically archive related messages

### Connectors

Manage all your connected platforms and services in one place.

### Disconnect / Revoke Access

If you no longer want openloomi to access a connected platform, you can disconnect it at any time:

1. Go to **Settings → Connectors**
2. Find the platform you want to disconnect
3. Click **[Disconnect]** or the remove (×) button
4. Confirm the action

Once disconnected:
- openloomi will immediately stop reading new messages from that platform
- Previously synced data is retained until manually deleted
- You can reconnect at any time by repeating the connection steps

> 💡 **Tip**: Before disconnecting, you may want to review what data has been synced in the **Privacy & Security** settings.

### Language

Change the language used in openloomi.

### Search

Search across all your messages, files, and conversations to find exactly what you need.

---

## Scheduled Tasks

Have AI automatically execute tasks at specified times.

### How to Create

1. Go to **Agent/Automation** page
2. Click **"New Task"**
3. Fill in task information:

| Field | Description | Example |
|-------|-------------|---------|
| Task Name | Give the task a name | "Daily News Summary" |
| Task Description | Tell AI what to do | "Search latest AI news, summarize and send to me" |
| Schedule Type | Cron/Interval/Once | `0 9 * * *` = 9am daily |
| Timezone | Time reference | "Asia/Shanghai" |

### Schedule Types

- **Cron Expression** — Flexible scheduling with cron syntax (e.g., `0 9 * * *` = every day at 9am, `0 9 * * 1` = every Monday at 9am)
- **Interval** — Run every X minutes/hours (e.g., every 30 minutes, every 2 hours)
- **One-Time** — Run once at a specific date and time

### Manage Tasks

- **Enable/Disable** — Turn tasks on or off
- **Run Now** — Execute immediately without waiting for the scheduled time
- **View History** — See past execution results, success/failure status, and output logs
- **Edit** — Modify task configuration
- **Delete** — Remove a task

### Example Use Cases

- **Daily News Summary**: "Search latest AI news, summarize top 5 stories and email to me" — every morning at 8am
- **Weekly Report**: "Generate weekly report on all project progress" — every Friday at 5pm
- **Periodic Reminder**: "Check calendar for upcoming meetings, remind me 15 minutes before" — every 30 minutes

---

## Knowledge Base

After uploading documents, you can ask AI questions about them directly.

### How to Use

1. **Upload documents** - Upload PDF, Word, text, etc. in settings
2. **Ask questions** - Ask AI "What's in the document about XXX?"
3. **Get full content** - View the complete document when needed

### Privacy Policy

Your privacy matters. Our Privacy Policy explains in detail how we collect, use, store, and protect your data — including what data we access, how it's encrypted, how long we retain it, and your rights to access, export, or delete it at any time.

### Privacy & Security

Your data, your sovereignty. openloomi puts privacy and control first—you never need to trade data sovereignty for intelligence.

### 🔐 Our Privacy Principles

#### Local-First Architecture
Your original messages and files **stay on your device**. openloomi only accesses the minimum data needed to complete tasks—no unnecessary uploads.
- Raw data never leaves your local environment
- Only processed results are transmitted when needed
- Complete control over what data openloomi can access

#### End-to-End Encryption
All authorized data is encrypted with **AES-256** industry standard, processed in hardware-isolated trusted execution environments.
- AES-256 encryption for all stored data
- Hardware-isolated trusted execution environments
- Zero visibility into your raw data

#### Zero Training Commitment
**Your data will never be used to train public AI models**—now or ever. In writing, legally guaranteed.
- Explicit legal commitment in our terms of service
- No use of your data for model training
- Full transparency on data usage

#### Auditable Compliance
All critical operations are logged in **tamper-proof audit logs**. SOC 2 compliance certification in progress.
- Complete audit trail of all data access
- SOC 2 compliance certification
- Enterprise-grade security standards

### 🔑 Your Data, Your Control

openloomi gives you complete control over your data:
- **Access Controls**: Choose exactly which platforms and data openloomi can access
- **Data Retention**: Configure how long openloomi retains processed data
- **Delete Anytime**: Delete all your data at any time with one click
- **Export**: Export all your data in standard formats

We believe **privacy and intelligence aren't mutually exclusive**. You should never have to choose between powerful AI capabilities and data control. openloomi delivers both.

---

## FAQ

### Q: How do I use openloomi?

A: It's simple!
1. Start a conversation in openloomi
2. Describe your needs directly
3. AI will understand and execute

### Q: How do I connect Telegram?

A:
1. Click **[Connect Telegram]**
2. Choose phone verification or QR code login
3. After completion, use @openloomiChatBot to access features

### Q: What are Insights?

A: Automatically extracted important information from your conversations, including to-dos, project progress, decision records, etc.

### Q: How do I create automation tasks?

A:

1. Go to Agent/Automation page
2. Click "New Task"
3. Fill in task name and description
4. Set execution time
5. Save

---

## Showcase: openloomi in Action

Real-world examples showing how openloomi works across different use cases.

### Chat Scenarios

#### Office: Smart Meeting Coordination

**Scenario**: A team needs to schedule a cross-timezone meeting.

```
User: Hey, find a time this week when everyone is available in the afternoon

openloomi:
📅 Found available slots for 5 team members:

| Time (PT) | Wed | Thu | Fri |
|-----------|-----|-----|-----|
| 2-3pm     | ✅  | ✅  | ❌ |
| 3-4pm     | ✅  | ✅  | ✅ |
| 4-5pm     | ❌  | ✅  | ✅ |

Recommended: Thursday 3-4pm (everyone available)
→ Want me to create a Google Calendar meeting?
```

**What it shows**: Google Calendar integration, multi-account availability lookup, natural language scheduling

---

#### R&D: Code Review Context

**Scenario**: A developer gets PR feedback and needs full context.

```
User: What's the status of PR #247?

openloomi:
📋 PR #247 Review Summary:

🔍 Related Discussion:
- @john: Suggested refactoring auth logic (comment #3)
- @sarah: Requested additional unit tests
- @mike: Approved with "LGTM"

📎 Linked Slack Threads:
#engineering: "Auth module refactoring plan" (3 messages)

📝 Extracted Tasks:
- [ ] Add auth test cases
- [ ] Update API documentation
- Due: This Friday

→ Want me to generate suggested changes?
```

**What it shows**: Cross-platform context aggregation, task extraction, timeline tracking

---

#### Marketing: Campaign Coordination

**Scenario**: Marketing team coordinating a product launch.

```
User: Is our Wednesday product launch ready?

openloomi:
🚀 Product Launch Status:

| Item | Status | Owner |
|------|--------|-------|
| Website update | ✅ Done | @marketing |
| Social posts | 🔄 In Progress | @social |
| Email blast | ⏳ Pending | @email |
| KOL outreach | ❌ Blocked | @partnerships |

⚠️ Blockers:
- KOL partnership awaiting legal approval
- Waiting for final product documentation

→ Want me to remind the team?
```

**What it shows**: Task status tracking, cross-team coordination, blocker identification

---

#### Collaboration: Project Kickoff

**Scenario**: Starting a new project with rapid setup.

```
User: Create a new client project called Acme Corp

openloomi:
✅ Project Acme Corp created!

Auto-completed:
📁 Google Drive folders
  - /Acme Corp/Contracts
  - /Acme Corp/Meeting Notes
  - /Acme Corp/Requirements

💬 Slack channels
  - #acme-general (project overview)
  - #acme-dev (technical)
  - #acme-support (client support)

📅 Shared calendar
  - Kickoff meeting (tomorrow 10am)
  - Weekly standup (Fridays 3pm)

👥 Team invitations sent
```

**What it shows**: Multi-platform automation, workflow orchestration

---

### Tracking Scenarios

#### Proactive: High-Priority Alerts

**Scenario**: System proactively identifies items needing attention.

```
📊 Today's Insights - March 12, 2026

🔥 Urgent (3)
├── PR #251 needs review - waiting 4 hours
├── Support tickets piling up - 12 unprocessed
└── Server alert - CPU at 95%

⭐ Important (5)
├── Q1 budget approval - due tomorrow
├── Acme contract renewal - 30 days left
└── ...

📋 Todo Tasks (8)
├── Reply to John's technical question - due today
├── Approve 3 team PTO requests
└── ...

→ View All | Mark Read | Remind Later
```

**What it shows**: Importance/urgency ranking, unreplied tracking, deadline reminders

---

#### Auto-Managed: Scheduled Refresh

**Scenario**: System automatically keeps information up to date.

```
⏰ Scheduled jobs running...

✅ RSS Feeds Updated
├── Tech News (5 new articles)
├── Product Management (2 new articles)
└── Competitor Updates (8 new articles)

✅ Insights Refreshed
├── Refresh interval: 30 minutes (high activity)
├── New insights: 6
└── Archived: 2

✅ Email Automation Triggered
├── User signed up 7 days ago → onboarding email
├── Free quota running low → upgrade reminder
└── Inactive 30 days → re-engagement email
```

**What it shows**: Scheduled RSS fetching, automated insight refresh, user lifecycle automation

---

### IM Platform Scenarios

#### Feishu: Enterprise Workflow

**Scenario**: Enterprise workflow automation.

```
Feishu Group:
User: Requesting PTO March 20-22

openloomi:
📝 PTO Request

| Field | Content |
|-------|---------|
| Applicant | @john |
| Dates | March 20-22 (3 days) |
| Type | Annual Leave |
| End Date | N/A |

Approver: @manager

[Approve] [Reject] [Request Info]
```

**What it shows**: Approval workflows, message handling, document integration

---

#### WhatsApp: Personal Assistant

**Scenario**: Managing personal tasks via WhatsApp.

```
WhatsApp conversation:
User: Set a reminder for tomorrow at 2pm

openloomi: ✅ Reminder set

⏰ Tomorrow 2:00pm
📌 Reminder: Call with John
📋 Context: Discussing Q1 proposal
   Client: john@acme.com
   Budget: $50,000
```

**What it shows**: QR pairing, status polling, reminder management

---

#### Discord: Community Management

**Scenario**: Automated community operations.

```
New member joins Discord server

openloomi Welcome Bot:
👋 Welcome @newuser!

I'm openloomi, your community assistant:

📚 Resources
- #announcements - Latest updates
- #help - Get support
- #showcase - Share projects

⚡ Quick Start
- [Introduce Yourself] Share your background
- [Set Up Profile] Customize your info
- [Browse Channels] Explore the community

Ask me anything!
```

**What it shows**: New member onboarding, FAQ automation, message handling

---

#### 🚀 Industry Intelligence Automation

**Scenario**: Automated AI product news monitoring with daily briefings.

```
User: Help me set up an industry intelligence automation

openloomi:
✅ Setting up your AI Product Daily Digest Assistant!

Step 1/4: Create Scheduled Task
────────────────────────────────
Task Name: AI Product Daily Digest
Schedule: Daily at 9 AM (Cron: 0 9 * * *)
Description:
1. Scrape X, Reddit, Product Hunt for AI product news
2. Summarize top 10 stories
3. Record to timeline as "AI Product Daily Updates"
4. Send briefing via Telegram

Step 2/4: Connect Data Sources
────────────────────────────────
✅ X (Twitter) - Connected
✅ Reddit - Connected
✅ Product Hunt - Connected
✅ Telegram - Connected

Step 3/4: Task Created
────────────────────────────────
🎉 Your automation is now active!

Next run: Tomorrow at 9:00 AM

Step 4/4: What You'll Receive
────────────────────────────────
☀️ Daily Telegram Briefing:
• Top AI product launches
• Trending discussions
• Engagement metrics

📰 Timeline Event:
• "AI 产品要闻每日更新"
• Full context for follow-up questions

🔮 Coming Soon:
• Visual dashboards
• Team sharing to Slack
```

**What it shows**: Scheduled tasks, multi-platform scraping, automated briefings, timeline recording

---

### Example: Daily Briefing Output

```
☀️ AI Product Daily Digest - March 15, 2026

🔥 Top 5 AI Product Launches Today:

1. 🎨 Claude Art (Product Hunt)
   AI image generation with style transfer
   247 upvotes

2. 💻 Devin 2.0 (X)
   AI coding assistant v2.0
   1.2K retweets

3. 🔧 LangChain v1.0 (Reddit)
   Major agent framework update
   89 upvotes

📈 Trend Summary:
- Image Generation: 🔥 Hot
- AI Coding: 📈 Growing

[View Full] [Create Follow-up] [Share]
```

**What it shows**: Multi-source aggregation, smart summarization, actionable outputs

---

## Reference

- openloomi website: https://openloomi.ai
- openloomi documents: https://openloomi.ai/docs
- Terms of Service: https://app.openloomi.ai/terms
- Privacy Policy: https://app.openloomi.ai/privacy
