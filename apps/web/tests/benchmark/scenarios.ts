import type { Insight } from "@/lib/db/schema";

export interface BenchmarkScenario {
  id: string;
  name: string;
  description: string;
  extraInfo?: string;
  /**
   * Test category - maps to TEST_DESIGN.md classification system:
   * - A1: False Positive Prevention
   * - A2: Attribution Accuracy
   * - A2.1: Request-Response Attribution
   * - A3: Cross-Project Isolation
   * - A4: Broadcast & Booking Link
   * - A5: Third-Party Interaction
   * - B1: Role-Based Immediate Assignment
   * - C1-C6: Role-Based Historical Assignment
   * - D1: When Parameter Accuracy
   * - D3: What Parameter Accuracy
   * - E1: Cross-Platform Deduplication
   * - E2: Time-Series Deduplication
   * - E3: Similar Task Differentiation
   * - E4: Semantic Deduplication
   * - F1: DM-Group Context Switch
   * - F2: Group Chat Scenarios
   * - G1: VIP Priority
   * - G2: Event Urgency
   * - G3: Role-Match Priority
   * - G4: Sales Response
   * - G5: Contextual Importance
   * - H1: Pronoun Resolution
   * - H2: Dependency Understanding
   * - H3: Conditional Logic
   * - H4: Multi-Step Tasks
   * - I1: Delegation Chain
   * - I2: Collaborative Tasks
   * - I3: Task Handoff
   * - I4: Escalation
   * - J1: Role Mismatch
   * - K1: Broadcast with Role Match
   * - M1: Waiting Status Management
   * - N1: Task Classification Exclusivity
   * - O1: Knowledge Synthesis
   * - O2: Memory Recall
   * - P1: Revenue Opportunity
   * - P2: Partnership Leads
   * - P3: Investor Updates
   * - P4: Opportunity Rescue
   * - P5: The Connector
   * - Q1: Context Switch Reduction
   * - Q2: Routine Automation
   * - Q3: High-Effort Extraction
   * - Q4: Smart Actions
   * - R1: Event-Driven Role Priority
   * - R2: Stable Relationship Management
   */
  category: string;
  priority: "P0" | "P1" | "P2"; // P0: Critical, P1: High, P2: Medium
  userProfile: {
    name: string;
    email: string;
    role?: string;
  };
  insights?: Array<Partial<Insight>>;
  messages: Array<{
    person: string;
    content: string;
    time: string;
    platform: string;
    channel: string;
  }>;
  expected: {
    urgency?: "immediate" | "24h" | "not_urgent";
    importance?: "high" | "medium" | "low";
    waitingForOthersCount?: number;
    myTasksCount?: number;
    insightCount?: number; // Expected number of separate insights (for clustering tests)
    tags?: string[]; // Category tags for important information (e.g., "Fundraising Progress", "Hiring Progress")
  };
}

export const BENCHMARK_SCENARIOS: BenchmarkScenario[] = [
  {
    id: "issue-1-false-urgent",
    name: "System Upgrade Notification (False Urgent)",
    description:
      "A system upgrade notification that is important but requires no action from the user should not be marked as urgent.",
    category: "A1",
    priority: "P0",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
      role: "Product Manager",
    },
    messages: [
      {
        person: "DevOps Bot",
        content:
          "Project Ocean V0.10.1 Upgrade: Manual DB deletion required. Before restarting Docker, you MUST manually delete the local `local_storage` file to prevent conflicts. Monitor Bot observed a sharp decrease in space.",
        time: "2024-05-20T10:00:00Z",
        platform: "Slack",
        channel: "announcements",
      },
    ],
    expected: {
      // urgency: "not_urgent", // Should not be immediate as user is PM, not Ops
      // importance: "medium", // It is important info, but not high priority for PM
    },
  },
  {
    id: "issue-2-incorrect-attribution",
    name: "Incorrect Attribution of Thanks",
    description:
      "A thanks B for fixing an issue. The summary should not say A thanks 'me' (User A) unless I am B.",
    category: "A2",
    priority: "P0",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
    },
    messages: [
      {
        person: "User F",
        content:
          "We fixed the ownership issue on the bridge. It should be working now.",
        time: "2024-05-21T09:55:00Z",
        platform: "Telegram",
        channel: "Project Bridge <> Project AI",
      },
      {
        person: "User B",
        content:
          "looks like it's not getting stuck anymore - I really appreciate the time spent investigating it, thanks for fixing!",
        time: "2024-05-21T10:00:00Z",
        platform: "Telegram",
        channel: "Project Bridge <> Project AI",
      },
    ],
    expected: {
      myTasksCount: 0,
    },
  },
  {
    id: "issue-3-irrelevant-waiting",
    name: "Irrelevant Waiting For Others",
    description:
      "User C promises to do something. Since this is not a promise TO me and doesn't block me, it should not be in waitingForOthers.",
    category: "K1",
    priority: "P1",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
    },
    messages: [
      {
        person: "Project Beacon Announcement",
        content:
          "Project Ocean V0.10.1 forced update. Requires new Docker image and snapshot.",
        time: "2024-05-22T10:00:00Z",
        platform: "Discord",
        channel: "validators",
      },
      {
        person: "User C",
        content: "I will handle the node upgrade and snapshot sync shortly.",
        time: "2024-05-22T10:05:00Z",
        platform: "Discord",
        channel: "validators",
      },
    ],
    expected: {
      myTasksCount: 0, // Should be 0 because User C's task is not for User A
      waitingForOthersCount: 1,
    },
  },
  {
    id: "issue-4-search-hallucination",
    name: "Cross-Project Aggregation (Project AI vs Project Beacon)",
    description:
      "Messages about Project AI and Project Beacon should be separated into different insights, not merged.",
    category: "A3",
    priority: "P1",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
    },
    messages: [
      {
        person: "User D",
        content: "Sent the latest BP for Project AI to User A.",
        time: "2024-05-23T10:00:00Z",
        platform: "WeChat",
        channel: "Project AI Core",
      },
      {
        person: "User E",
        content:
          "Regarding the 500k fund in the agreement, I asked the Project Beacon team about the Token/Cash split.",
        time: "2024-05-23T10:05:00Z",
        platform: "WeChat",
        channel: "Project Beacon Discussion", // Different channel, different topic
      },
    ],
    expected: {
      insightCount: 2, // Should be 2 separate insights
    },
  },
  {
    id: "issue-5-irrelevant-dm",
    name: "Irrelevant DM in Group Chat",
    description:
      "User B tells User C they will DM them. This should NOT be marked as urgent for User A, nor create a task.",
    category: "K1",
    priority: "P1",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
    },
    messages: [
      {
        person: "User B",
        content: "Does anyone have the logs for the failed build?",
        time: "2024-05-24T10:00:00Z",
        platform: "Discord",
        channel: "dev-ops",
      },
      {
        person: "User C",
        content: "I have them locally. I'll DM you.",
        time: "2024-05-24T10:05:00Z",
        platform: "Discord",
        channel: "dev-ops",
      },
      {
        person: "User B",
        content: "Thanks, checking my DMs now.",
        time: "2024-05-24T10:10:00Z",
        platform: "Discord",
        channel: "dev-ops",
      },
    ],
    expected: {
      urgency: "not_urgent",
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-6-passive-observer",
    name: "Passive Observer in Technical Group",
    description:
      "Users discuss technical issues/status in a group. User A is silent. Should NOT generate tasks for User A.",
    category: "K1",
    priority: "P1",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
    },
    messages: [
      {
        person: "User B",
        content: "Upgraded and synching.",
        time: "2024-05-25T10:00:00Z",
        platform: "Discord",
        channel: "validators",
      },
      {
        person: "User C",
        content:
          "Hey, we're getting error Failed to initialize service impl. when starting with the snapshot.",
        time: "2024-05-25T10:05:00Z",
        platform: "Discord",
        channel: "validators",
      },
      {
        person: "User D",
        content: "Thanks a lot, that helped.",
        time: "2024-05-25T10:10:00Z",
        platform: "Discord",
        channel: "validators",
      },
    ],
    expected: {
      urgency: "not_urgent",
      waitingForOthersCount: 0,
      myTasksCount: 0,
    },
  },
  {
    id: "issue-7-important-no-action",
    name: "Important Event but No Action Required",
    description:
      "A critical issue is reported (High Importance), but someone else is handling it. User A should see it as Important, but NOT have a task.",
    category: "K1",
    priority: "P1",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
    },
    messages: [
      {
        person: "User B",
        content:
          "CRITICAL: Production API Gateway is returning 500 errors! System is down.",
        time: "2024-05-26T10:00:00Z",
        platform: "Slack",
        channel: "incidents",
      },
      {
        person: "User C",
        content: "I'm on it. Rolling back the last deployment.",
        time: "2024-05-26T10:02:00Z",
        platform: "Slack",
        channel: "incidents",
      },
      {
        person: "User B",
        content: "Thanks C. Let us know when it's stable.",
        time: "2024-05-26T10:05:00Z",
        platform: "Slack",
        channel: "incidents",
      },
    ],
    expected: {
      importance: "high", // Critical issue
      urgency: "not_urgent", // User A doesn't need to act immediately (C is handling it)
      myTasksCount: 0, // User A has no task
      waitingForOthersCount: 0, // C is fixing system, not a personal promise to A
    },
  },
  {
    id: "issue-8-explicit-mention-urgent",
    name: "Explicit Mention in Noisy Group",
    description:
      "In a noisy group with other discussions, CiCi is explicitly mentioned to fix a critical bug. Should be Urgent and a Task.",
    category: "K1",
    priority: "P1",
    userProfile: {
      name: "CiCi",
      email: "user.a@example.com",
    },
    messages: [
      {
        person: "User B",
        content: "Did anyone see the game last night?",
        time: "2024-05-27T10:00:00Z",
        platform: "Slack",
        channel: "random",
      },
      {
        person: "User C",
        content: "Yeah, it was crazy.",
        time: "2024-05-27T10:01:00Z",
        platform: "Slack",
        channel: "random",
      },
      {
        person: "User D",
        content:
          "@CiCi The payment service is throwing 500s. We need you to look at this ASAP.",
        time: "2024-05-27T10:05:00Z",
        platform: "Slack",
        channel: "random",
      },
      {
        person: "User B",
        content: "Anyway, back to the game...",
        time: "2024-05-27T10:06:00Z",
        platform: "Slack",
        channel: "random",
      },
    ],
    expected: {
      importance: "high",
      urgency: "immediate", // Explicit mention + ASAP + Critical
      myTasksCount: 1,
    },
  },
  {
    id: "issue-9-implicit-you",
    name: "Implicit 'You' Context",
    description:
      "User B asks a question. User C replies 'I'll DM you'. 'You' refers to User B, NOT User A (me).",
    category: "K1",
    priority: "P1",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
    },
    messages: [
      {
        person: "User B",
        content: "Is anyone having problems with Docker restarting cyclically?",
        time: "2024-05-28T10:00:00Z",
        platform: "Discord",
        channel: "validators",
      },
      {
        person: "User C",
        content: "hi, I'll DM you",
        time: "2024-05-28T10:01:00Z",
        platform: "Discord",
        channel: "validators",
      },
      {
        person: "User D",
        content: "synchronized and working stably now",
        time: "2024-05-28T10:05:00Z",
        platform: "Discord",
        channel: "validators",
      },
    ],
    expected: {
      urgency: "not_urgent",
      myTasksCount: 0,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-9-implicit-you-2",
    name: "Implicit 'You' Context",
    description:
      "User B asks a question. User C replies 'I'll DM you'. 'You' refers to User B, NOT User A (me).",
    category: "K1",
    priority: "P1",
    userProfile: {
      name: "CiCi",
      email: "user.a@example.com",
    },
    messages: [
      {
        person: "UserB",
        content:
          "Hey, I hope everyone's doing great. l noticed you've launched recently, happy to see the progress. Would love to reconnect and continue our previous conversation @UserC @UserD",
        time: "2024-05-28T10:00:00Z",
        platform: "Telegram",
        channel: "Project A <> Project B",
      },
      {
        person: "UserC",
        content: "sure, let's have a chat this week",
        time: "2024-05-28T10:01:00Z",
        platform: "Telegram",
        channel: "Project A <> Project B",
      },
      {
        person: "UserB",
        content:
          "Here's my calendly: https://calendly.com/userb/30min Or just send yours 🙏",
        time: "2024-05-28T10:05:00Z",
        platform: "Telegram",
        channel: "Project A <> Project B",
      },
      {
        person: "UserE",
        content:
          "Hey team! ls anyone traveling to Abu Dhabi next week? if you are, please pass by our event :) https://luma.com/links",
        time: "2024-05-28T10:06:00Z",
        platform: "Telegram",
        channel: "Project A <> Project B",
      },
    ],
    expected: {
      myTasksCount: 0,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-9-implicit-me",
    name: "Implicit 'Me' Context",
    description: "UserB",
    category: "K1",
    priority: "P1",
    userProfile: {
      name: "CiCi",
      email: "user.a@example.com",
    },
    messages: [
      {
        person: "UserB",
        content:
          "Hi @UserC @UserD @UserE pls track task status here. https://app.clickup.com/t/86dykh7v0",
        time: "2024-05-28T10:00:00Z",
        platform: "Telegram",
        channel: "Project MKT",
      },
      {
        person: "UserB",
        content:
          "Hi @UserC can you send monthly newsletter test mail to @UserF and me?",
        time: "2024-05-28T10:01:00Z",
        platform: "Telegram",
        channel: "Project MKT",
      },
      {
        person: "UserC",
        content: "yep, sure. On it. will be sent soon",
        time: "2024-05-28T10:05:00Z",
        platform: "Telegram",
        channel: "Project MKT",
      },
    ],
    expected: {
      myTasksCount: 0,
      waitingForOthersCount: 1,
    },
  },
  {
    id: "issue-10-error-magnet",
    name: "Error Magnet (Group Errors != My Tasks)",
    description:
      "Multiple users report errors in a group. User A is NOT an admin/support. Should NOT generate tasks for User A.",
    category: "K1",
    priority: "P1",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
    },
    messages: [
      {
        person: "User B",
        content:
          "Error: Failed to initialize service impl. when starting with snapshot.",
        time: "2024-05-29T10:00:00Z",
        platform: "Discord",
        channel: "validators",
      },
      {
        person: "User C",
        content: "I'm seeing the same thing. Docker keeps restarting.",
        time: "2024-05-29T10:05:00Z",
        platform: "Discord",
        channel: "validators",
      },
      {
        person: "User D",
        content: "My node is stuck at block 1000.",
        time: "2024-05-29T10:10:00Z",
        platform: "Discord",
        channel: "validators",
      },
    ],
    expected: {
      urgency: "not_urgent",
      myTasksCount: 0,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-11-self-scheduling",
    name: "Self Scheduling (Don't Schedule with Myself)",
    description:
      "User A shares their own Calendly link. User B books it. AI should NOT ask User A to schedule a meeting with User A.",
    category: "K1",
    priority: "P1",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
    },
    messages: [
      {
        person: "User A",
        content: "Here's mine, thx https://calendly.com/user-a/30min",
        time: "2024-05-30T10:00:00Z",
        platform: "Telegram",
        channel: "external-collab",
      },
      {
        person: "User B",
        content: "Nice, just booked something for Tuesday.",
        time: "2024-05-30T10:05:00Z",
        platform: "Telegram",
        channel: "external-collab",
      },
    ],
    expected: {
      urgency: "not_urgent",
      myTasksCount: 0,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-12-sender-not-reviewer",
    name: "Sender Not Reviewer (I provided info, don't ask me to review it)",
    description:
      "User A provides materials/links to User B. AI should NOT generate a task for User A to review the materials they just sent.",
    category: "K1",
    priority: "P1",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
    },
    messages: [
      {
        person: "User B",
        content: "Any more background info on your project?",
        time: "2024-05-31T10:00:00Z",
        platform: "Telegram",
        channel: "collab",
      },
      {
        person: "User A",
        content:
          "Here is the background. We have a full stack AI infra. Materials: Twitter: https://x.com/Project Website: https://project.network/ Gitbook: https://docs.project.network/ Feel free to take a look.",
        time: "2024-05-31T10:05:00Z",
        platform: "Telegram",
        channel: "collab",
      },
    ],
    expected: {
      urgency: "not_urgent",
      myTasksCount: 0,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-13-question-magnet",
    name: "Question Magnet (General Questions != My Tasks)",
    description:
      "User B asks a general technical question in a group. User A is NOT admin/support. AI should NOT generate a task for User A to answer.",
    category: "K1",
    priority: "P1",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
    },
    messages: [
      {
        person: "User B",
        content:
          "are these worrisome logs? [2025-11-24] block agent get public key failed: 70006",
        time: "2024-06-01T10:00:00Z",
        platform: "Telegram",
        channel: "validators",
      },
      {
        person: "User C",
        content: "Upgraded. It is expected to take approximately 10 hours.",
        time: "2024-06-01T10:05:00Z",
        platform: "Telegram",
        channel: "validators",
      },
    ],
    expected: {
      urgency: "not_urgent",
      myTasksCount: 0,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-14-mention-others-not-me",
    name: "Mention Others (Explicitly @Others != My Task)",
    description:
      "User A explicitly mentions @UserB and @UserC. User D (me) is NOT mentioned. AI should NOT generate a task for User D, and Summary should correctly identify A as the requester.",
    category: "A2",
    priority: "P0",
    userProfile: {
      name: "User D",
      email: "user.d@example.com",
    },
    messages: [
      {
        person: "User A",
        content:
          "@UserB @UserC just want to catch up on this one, if could guide us next step, we would like to get the users onboarded",
        time: "2024-06-02T10:00:00Z",
        platform: "Telegram",
        channel: "cross-chain",
      },
    ],
    expected: {
      urgency: "not_urgent",
      myTasksCount: 0,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-15-broadcast-booking-link",
    name: "Broadcast with Booking Link (No Self-Task)",
    description:
      "User sends a broadcast message with a Calendly link. AI should NOT generate a 'Schedule meeting' task for the user.",
    category: "A4",
    priority: "P0",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
    },
    messages: [
      {
        person: "User A",
        content:
          "Hi Team, thanks for filling out the mainnet readiness form. Let's hop on a call to understand your needs... https://calendly.com/user-a/30min",
        time: "2024-11-24T20:35:00Z",
        platform: "Telegram",
        channel: "Project X <> Project Y",
      },
    ],
    expected: {
      urgency: "not_urgent",
      myTasksCount: 0,
      waitingForOthersCount: 0, // Or 1 if we consider it a request to others, but definitely 0 for myTasks
    },
  },
  {
    id: "issue-16-broadcast-false-mention",
    name: "Broadcast False Mention (Send me != Mention me)",
    description:
      "User sends a broadcast message asking 'Send me your links'. AI should NOT interpret 'me' as the user (recipient) and should NOT generate a task for the user unless explicitly mentioned.",
    category: "K1",
    priority: "P1",
    userProfile: {
      name: "User B",
      email: "user.b@example.com",
    },
    messages: [
      {
        person: "User A",
        content:
          "Hey builders! We're publishing a big Testnet Guide. If you want your project to be included: Send me: 1. Your dApp link 2. Your X profile",
        time: "2024-11-25T05:36:00Z",
        platform: "Telegram",
        channel: "Project P Builders Harbor",
      },
    ],
    expected: {
      urgency: "not_urgent",
      myTasksCount: 0,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-17-irrelevant-third-party",
    name: "Irrelevant Third Party (A promises B != myTasks)",
    description:
      "User C (me) is in a group where A promises B to review a document. AI should NOT generate a 'waitingForOthers' task for User C.",
    category: "A5",
    priority: "P1",
    userProfile: {
      name: "User C",
      email: "user.c@example.com",
    },
    messages: [
      {
        person: "User A",
        content: "Hey User B, I will review the tech doc by tomorrow.",
        time: "2024-11-25T13:23:00Z",
        platform: "Telegram",
        channel: "Project Alpha",
      },
      {
        person: "User B",
        content: "Thanks User A, that helps a lot.",
        time: "2024-11-25T13:25:00Z",
        platform: "Telegram",
        channel: "Project Alpha",
      },
    ],
    expected: {
      // urgency: "not_urgent",
      myTasksCount: 0,
      waitingForOthersCount: 1,
    },
  },
  {
    id: "issue-18-explicit-addressee",
    name: "Explicit Addressee (User B... != User C)",
    description:
      "User A explicitly asks 'User B, ...'. User C (me) should NOT get a task.",
    category: "A2",
    priority: "P0",
    userProfile: {
      name: "User C",
      email: "user.c@example.com",
    },
    messages: [
      {
        person: "User A | Project Alpha",
        content:
          "User B, do you have any other recommended service providers besides Provider X for Project Beta testnet?",
        time: "2024-11-25T14:33:00Z",
        platform: "Telegram",
        channel: "Project Alpha <> Project Beta",
      },
    ],
    expected: {
      urgency: "not_urgent",
      myTasksCount: 0,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-19-redundant-schedule-persist",
    name: "Redundant Schedule Persist (Broadcast Link)",
    description:
      "User sends a broadcast with a Calendly link. Ensure 'Schedule meeting' task is definitely NOT generated.",
    category: "A4",
    priority: "P1",
    userProfile: {
      name: "User D",
      email: "user.d@example.com",
    },
    messages: [
      {
        person: "User D",
        content:
          "Hi Team, let's hop on a call to understand your needs... https://calendly.com/user-d/30min",
        time: "2024-11-24T20:35:00Z",
        platform: "Telegram",
        channel: "Project Alpha <> Project Beta",
      },
    ],
    expected: {
      urgency: "not_urgent",
      myTasksCount: 0,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-20-support-request-no-mention",
    name: "General Support Request (Hi Team != Task for Me)",
    description:
      "User E asks 'Hi team, could you please provide...'. User F (me) should NOT get a task unless explicitly mentioned.",
    category: "K1",
    priority: "P1",
    userProfile: {
      name: "User F",
      email: "user.f@example.com",
    },
    messages: [
      {
        person: "User E",
        content:
          "Hi team, I have a question regarding the new Project Gamma release... could you please provide the placeholder password so I can update the environment variables?",
        time: "2024-11-25T16:46:00Z",
        platform: "Telegram",
        channel: "Project Gamma Validator Group",
      },
    ],
    expected: {
      // urgency: "not_urgent",
      myTasksCount: 0,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-21-role-based-urgent-ops",
    name: "Role-Based Urgent Assignment (Ops Role + Server Down)",
    extraInfo:
      "I'm the operations/DevOps engineer for Project X, if the server or API down, assign me tasks.",
    description:
      "User A previously stated they are the ops for Project X. 3 weeks later, someone reports Project X server is down. User A should get an urgent task.",
    category: "C1",
    priority: "P0",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
    },
    messages: [
      {
        person: "User A",
        content:
          "Just to clarify, I'm the ops/DevOps engineer for Project X, so feel free to reach out if there are any infrastructure issues.",
        time: "2024-11-01T10:00:00Z",
        platform: "Telegram",
        channel: "Project X Community",
      },
      {
        person: "User G",
        content:
          "Hi team, Project X API is down! Getting 502 errors on all endpoints. This is blocking our production deployment.",
        time: "2024-11-22T15:30:00Z",
        platform: "Telegram",
        channel: "Project X Community",
      },
    ],
    expected: {
      urgency: "immediate",
      importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-22-role-based-important-ecosystem",
    name: "Role-Based Important Assignment (Ecosystem Role + Strategy Question)",
    description:
      "User B previously stated they are on Project Y ecosystem team. 2 weeks later, someone asks about Project Y ecosystem strategy. User B should get an important task.",
    extraInfo:
      "I'm part of the ecosystem team for Project Y, if there are questions about partnerships or developer programs, assign me tasks.",
    category: "C2",
    priority: "P1",
    userProfile: {
      name: "User B",
      email: "user.b@example.com",
    },
    messages: [
      {
        person: "User B",
        content:
          "Hi everyone! I'm part of the Project Y ecosystem team, responsible for partnerships and developer support programs.",
        time: "2024-11-05T14:00:00Z",
        platform: "Telegram",
        channel: "Project Y Builders",
      },
      {
        person: "User H",
        content:
          "Does Project Y have any plans for ecosystem grants or developer incentive programs? We're building a DeFi protocol and would love to integrate.",
        time: "2024-11-20T11:00:00Z",
        platform: "Telegram",
        channel: "Project Y Builders",
      },
    ],
    expected: {
      // urgency: "24h",
      // importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-23-role-based-group-admin",
    name: "Role-Based Assignment (Group Admin + Moderation Issue)",
    description:
      "User C is the group admin. When someone reports spam/abuse, User C should get an urgent task.",
    extraInfo:
      "I'm the admin of this group, if there are reports of spam, scams, or moderation issues, assign me tasks.",
    category: "C5",
    priority: "P1",
    userProfile: {
      name: "User C",
      email: "user.c@example.com",
    },
    messages: [
      {
        person: "User C",
        content:
          "Welcome everyone! I'm the admin of this group. If you encounter any spam, scams, or need help, please tag me.",
        time: "2024-11-08T09:00:00Z",
        platform: "Telegram",
        channel: "Project Z Community",
      },
      {
        person: "User I",
        content:
          "Hey admin, there's a scammer DMing people pretending to be from the Project Z team asking for wallet seeds. Can someone ban them?",
        time: "2024-11-25T18:00:00Z",
        platform: "Telegram",
        channel: "Project Z Community",
      },
    ],
    expected: {
      urgency: "immediate",
      importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-24-role-based-tech-lead",
    name: "Role-Based Assignment (Tech Lead + Architecture Question)",
    description:
      "User D is the tech lead. When someone asks about technical architecture decisions, User D should get a high priority task.",
    extraInfo:
      "I'm the technical lead for Project Alpha, if there are questions about architecture, smart contracts, or integration, assign me high priority tasks.",
    category: "C3",
    priority: "P1",
    userProfile: {
      name: "User D",
      email: "user.d@example.com",
    },
    messages: [
      {
        person: "User D",
        content:
          "Hi team, I'm the technical lead for Project Alpha. Happy to answer any questions about our architecture, smart contracts, or integration.",
        time: "2024-11-03T11:30:00Z",
        platform: "Discord",
        channel: "Project Alpha Dev",
      },
      {
        person: "User J",
        content:
          "What's the recommended approach for integrating with Project Alpha's oracle system? Should we use the direct feed or the aggregator contract?",
        time: "2024-11-18T14:20:00Z",
        platform: "Discord",
        channel: "Project Alpha Dev",
      },
    ],
    expected: {
      // urgency: "24h",
      // importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-25-role-based-product-manager",
    name: "Role-Based Assignment (Product Manager + Feature Request)",
    description:
      "User E is the product manager. When someone asks about roadmap or feature requests, User E should get a high priority task.",
    extraInfo:
      "I'm the product manager for Project Beta, if there are questions about roadmap or feature requests, assign me tasks.",
    category: "C4",
    priority: "P1",
    userProfile: {
      name: "User E",
      email: "user.e@example.com",
    },
    messages: [
      {
        person: "User E",
        content:
          "I'm the product manager for Project Beta. Feel free to share feature requests or ask about our roadmap!",
        time: "2024-11-10T10:00:00Z",
        platform: "Telegram",
        channel: "Project Beta Feedback",
      },
      {
        person: "User K",
        content:
          "Are there any plans to add multi-chain support? Our users are asking for Arbitrum and Optimism compatibility.",
        time: "2024-11-24T16:45:00Z",
        platform: "Telegram",
        channel: "Project Beta Feedback",
      },
    ],
    expected: {
      // urgency: "24h",
      // importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-26-role-based-community-manager",
    name: "Role-Based Assignment (Community Manager + Event Question)",
    description:
      "User F is the community manager. When someone asks about events or community programs, User F should get a high priority task.",
    extraInfo:
      "I'm the community manager for Project Gamma, if there are questions about events or community programs, assign me high priority tasks make importance high.",
    category: "C6",
    priority: "P1",
    userProfile: {
      name: "User F",
      email: "user.f@example.com",
    },
    messages: [
      {
        person: "User F",
        content:
          "Hey everyone! I'm the community manager for Project Gamma. I handle AMAs, events, and community initiatives. Hit me up with ideas!",
        time: "2024-11-07T15:00:00Z",
        platform: "Discord",
        channel: "Project Gamma General",
      },
      {
        person: "User L",
        content:
          "When is the next AMA? We have a lot of questions about the upcoming token launch and would love to hear from the team.",
        time: "2024-11-21T12:30:00Z",
        platform: "Discord",
        channel: "Project Gamma General",
      },
    ],
    expected: {
      urgency: "24h",
      // importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  // ========== Action Acceptance Rate ==========
  {
    id: "issue-27-clear-action-with-deadline",
    name: "Clear Action with Explicit Deadline (Should Accept)",
    description:
      "Clear, actionable request with explicit deadline. Should generate a task that user would accept.",
    category: "D1",
    priority: "P1",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
    },
    messages: [
      {
        person: "User B",
        content:
          "Hey User A, can you review the smart contract audit report and send me your feedback by Friday EOD? It's critical for our mainnet launch timeline.",
        time: "2024-11-25T10:00:00Z",
        platform: "Slack",
        channel: "project-alpha",
      },
    ],
    expected: {
      urgency: "24h",
      importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-28-implicit-action-from-context",
    name: "Implicit Action from Context (Should Accept)",
    description:
      "Action is implied from context, not explicitly stated. Good AI should infer the task.",
    category: "D3",
    priority: "P1",
    userProfile: {
      name: "CiCi",
      email: "user.c@example.com",
    },
    messages: [
      {
        person: "User D",
        content:
          "The API integration is failing in production. Error logs show authentication issues. CiCi, you implemented the auth module, right?",
        time: "2024-11-25T15:30:00Z",
        platform: "Discord",
        channel: "tech-support",
      },
    ],
    expected: {
      urgency: "immediate",
      importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  // ========== Hallucination / False Positive Rate ==========
  {
    id: "issue-29-casual-chat-no-action",
    name: "Casual Chat - No Action (Should NOT Generate Task)",
    description:
      "Casual conversation with no actionable items. AI should NOT hallucinate a task.",
    category: "A1",
    priority: "P0",
    userProfile: {
      name: "User E",
      email: "user.e@example.com",
    },
    messages: [
      {
        person: "User F",
        content:
          "Hey User E, how was your weekend? Did you end up going to that concert?",
        time: "2024-11-25T09:00:00Z",
        platform: "Telegram",
        channel: "random-chat",
      },
      {
        person: "User E",
        content:
          "It was great! The band was amazing. We should go together next time.",
        time: "2024-11-25T09:05:00Z",
        platform: "Telegram",
        channel: "random-chat",
      },
    ],
    expected: {
      urgency: "not_urgent",
      myTasksCount: 0,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-30-rhetorical-question-no-action",
    name: "Rhetorical Question - No Action (Should NOT Generate Task)",
    description:
      "Rhetorical or hypothetical question. AI should NOT treat it as a task.",
    category: "A1",
    priority: "P1",
    userProfile: {
      name: "User G",
      email: "user.g@example.com",
    },
    messages: [
      {
        person: "User H",
        content:
          "Wouldn't it be cool if we could integrate with every blockchain? Imagine the possibilities!",
        time: "2024-11-25T11:00:00Z",
        platform: "Discord",
        channel: "brainstorming",
      },
    ],
    expected: {
      urgency: "not_urgent",
      myTasksCount: 0,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-31-fyi-information-only",
    name: "FYI / Information Only (Should NOT Generate Task)",
    description:
      "Pure information sharing with no action required. AI should NOT create a task.",
    category: "A1",
    priority: "P1",
    userProfile: {
      name: "User I",
      email: "user.i@example.com",
    },
    messages: [
      {
        person: "User J",
        content:
          "FYI - The testnet will be upgraded to v2.0 this weekend. No action needed from your side, just wanted to keep you in the loop.",
        time: "2024-11-25T14:00:00Z",
        platform: "Slack",
        channel: "announcements",
      },
    ],
    expected: {
      urgency: "not_urgent",
      myTasksCount: 0,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-32-already-completed-action",
    name: "Already Completed Action (Should NOT Generate Task)",
    description:
      "User mentions they already did something. AI should NOT create a duplicate task.",
    category: "A1",
    priority: "P1",
    userProfile: {
      name: "User K",
      email: "user.k@example.com",
    },
    messages: [
      {
        person: "User L",
        content: "User K, did you send the proposal to the client?",
        time: "2024-11-25T10:00:00Z",
        platform: "Email",
        channel: "project-beta",
      },
      {
        person: "User K",
        content:
          "Yes, I already sent it yesterday morning. They should have received it.",
        time: "2024-11-25T10:05:00Z",
        platform: "Email",
        channel: "project-beta",
      },
    ],
    expected: {
      urgency: "not_urgent",
      myTasksCount: 0,
      waitingForOthersCount: 0,
    },
  },
  // ========== Parameter Correction Rate ==========
  {
    id: "issue-33-ambiguous-deadline",
    name: "Ambiguous Deadline - Needs Correction (Test When Parameter)",
    description:
      "Deadline is ambiguous ('soon', 'ASAP'). AI should make best guess but may need user correction.",
    category: "D1",
    priority: "P1",
    userProfile: {
      name: "User M",
      email: "user.m@example.com",
    },
    messages: [
      {
        person: "User N",
        content:
          "User M, please update the documentation ASAP. The new developers are starting soon.",
        time: "2024-11-25T16:00:00Z",
        platform: "Slack",
        channel: "documentation",
      },
    ],
    expected: {
      // urgency: "immediate",
      importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-34-unclear-assignee",
    name: "Unclear Assignee - Needs Correction (Test Who Parameter)",
    description:
      "Task mentions 'someone' or 'team' without clear assignment. AI should infer but may need correction.",
    extraInfo:
      "I'm part of the backend team, if there are backend issues, assign me tasks.",
    category: "A2",
    priority: "P1",
    userProfile: {
      name: "User O",
      email: "user.o@example.com",
    },
    messages: [
      {
        person: "User P",
        content:
          "We need someone from the backend team to fix the database connection pooling issue. It's causing timeouts.",
        time: "2024-11-25T13:00:00Z",
        platform: "Discord",
        channel: "backend-team",
      },
    ],
    expected: {
      // urgency: "24h",
      // importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-35-vague-description",
    name: "Vague Description - Needs Correction (Test What Parameter)",
    description:
      "Task description is vague ('look into', 'check on'). AI should capture but may need user to clarify.",
    category: "D3",
    priority: "P1",
    userProfile: {
      name: "User Q",
      email: "user.q@example.com",
    },
    messages: [
      {
        person: "User R",
        content:
          "User Q, can you look into the performance issues we've been seeing? Users are complaining about slow load times.",
        time: "2024-11-25T11:30:00Z",
        platform: "Slack",
        channel: "performance",
      },
    ],
    expected: {
      urgency: "24h",
      importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-36-multiple-deadlines-conflict",
    name: "Multiple Conflicting Deadlines (Test When Parameter)",
    description:
      "Message contains conflicting time references. AI should pick the most urgent/explicit one.",
    category: "D1",
    priority: "P2",
    userProfile: {
      name: "User S",
      email: "user.s@example.com",
    },
    messages: [
      {
        person: "User T",
        content:
          "User S, we need the security audit by end of month, but ideally by next week if possible. The sooner the better!",
        time: "2024-11-25T09:00:00Z",
        platform: "Email",
        channel: "security",
      },
    ],
    expected: {
      urgency: "24h",
      // importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  // ========== Entity Resolution Accuracy ==========
  {
    id: "issue-37-cross-channel-same-task",
    name: "Cross-Channel Same Task (Should Merge)",
    description:
      "Same task mentioned across different platforms. AI should recognize and merge into ONE task.",
    category: "E1",
    priority: "P1",
    userProfile: {
      name: "User U",
      email: "user.u@example.com",
    },
    messages: [
      {
        person: "User V",
        content:
          "User U, don't forget to send me the Q4 financial report for review.",
        time: "2024-11-25T10:00:00Z",
        platform: "Slack",
        channel: "finance",
      },
      {
        person: "User V",
        content:
          "Hi User U, just following up on the Q4 financial report. Need it by Friday.",
        time: "2024-11-25T15:00:00Z",
        platform: "Email",
        channel: "finance-team",
      },
    ],
    expected: {
      urgency: "24h",
      importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-38-follow-up-same-task",
    name: "Follow-up on Same Task (Should Merge)",
    description:
      "Follow-up message about the same task. AI should update existing task, not create duplicate.",
    category: "E2",
    priority: "P1",
    userProfile: {
      name: "User W",
      email: "user.w@example.com",
    },
    messages: [
      {
        person: "User X",
        content:
          "User W, can you prepare the presentation for Monday's board meeting?",
        time: "2024-11-22T09:00:00Z",
        platform: "Slack",
        channel: "executive",
      },
      {
        person: "User X",
        content:
          "Quick update on the presentation - please include the new market analysis slides as well.",
        time: "2024-11-24T14:00:00Z",
        platform: "Slack",
        channel: "executive",
      },
    ],
    expected: {
      urgency: "24h",
      importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-39-similar-but-different-tasks",
    name: "Similar But Different Tasks (Should NOT Merge)",
    description:
      "Two similar but distinct tasks. AI should create TWO separate tasks, not merge.",
    category: "E3",
    priority: "P2",
    userProfile: {
      name: "CiCi",
      email: "user.y@example.com",
    },
    messages: [
      {
        person: "User Z",
        content: "@CiCi, please review the frontend code for the login module.",
        time: "2024-11-25T10:00:00Z",
        platform: "GitHub",
        channel: "pull-requests",
      },
      {
        person: "User Z",
        content:
          "CiCi, also need you to review the backend API for the login endpoint.",
        time: "2024-11-25T10:30:00Z",
        platform: "GitHub",
        channel: "pull-requests",
      },
    ],
    expected: {
      // urgency: "24h",
      importance: "medium",
      myTasksCount: 2,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-40-task-completion-update",
    name: "Task Completion Update (Should Close, Not Duplicate)",
    description:
      "User reports task completion. AI should mark existing task as done, not create new task.",
    category: "E2",
    priority: "P1",
    userProfile: {
      name: "User AA",
      email: "user.aa@example.com",
    },
    messages: [
      {
        person: "User BB",
        content:
          "User AA, please deploy the hotfix to production by end of day.",
        time: "2024-11-25T09:00:00Z",
        platform: "Slack",
        channel: "devops",
      },
      {
        person: "User AA",
        content:
          "Hotfix deployed successfully. All systems are running normally now.",
        time: "2024-11-25T17:00:00Z",
        platform: "Slack",
        channel: "devops",
      },
    ],
    expected: {
      // urgency: "not_urgent",
      myTasksCount: 0,
      waitingForOthersCount: 0,
    },
  },
  // ========== Time Dimension ==========
  {
    id: "issue-41-overdue-task-escalation",
    name: "Overdue Task Escalation (Past Deadline)",
    description:
      "Task deadline has passed. AI should mark as overdue and escalate urgency.",
    category: "D1",
    priority: "P1",
    userProfile: {
      name: "CiCi",
      email: "user.a@example.com",
    },
    messages: [
      {
        person: "User B",
        content:
          "CiCi, reminder - the contract review was due yesterday. Client is waiting.",
        time: "2024-11-26T10:00:00Z",
        platform: "Email",
        channel: "legal",
      },
    ],
    expected: {
      // urgency: "immediate",
      // importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-42-recurring-task-pattern",
    name: "Recurring Task Pattern (Weekly/Monthly)",
    description:
      "Task mentions recurring pattern. AI should recognize and set appropriate recurrence.",
    category: "D1",
    priority: "P2",
    userProfile: {
      name: "User C",
      email: "user.c@example.com",
    },
    messages: [
      {
        person: "User D",
        content:
          "User C, please send me the weekly status report every Friday by 5pm. Starting this week.",
        time: "2024-11-25T09:00:00Z",
        platform: "Slack",
        channel: "project-updates",
      },
    ],
    expected: {
      // urgency: "24h",
      importance: "medium",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-43-time-zone-awareness",
    name: "Time Zone Awareness (Different Regions)",
    description:
      "Deadline mentions specific time zone. AI should handle correctly.",
    category: "D1",
    priority: "P1",
    userProfile: {
      name: "CiCi",
      email: "user.e@example.com",
    },
    messages: [
      {
        person: "User F",
        content:
          "CiCi, we need the deployment done by 9am EST tomorrow for the US market launch.",
        time: "2024-11-25T20:00:00Z",
        platform: "Slack",
        channel: "devops",
      },
    ],
    expected: {
      // urgency: "immediate",
      importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-44-long-term-vs-short-term",
    name: "Long-term vs Short-term Priority",
    description:
      "Two tasks: one urgent short-term, one important long-term. AI should prioritize correctly.",
    category: "G2",
    priority: "P2",
    userProfile: {
      name: "User G",
      email: "user.g@example.com",
    },
    messages: [
      {
        person: "User H",
        content: "User G, hotfix needed ASAP - production is down!",
        time: "2024-11-25T14:00:00Z",
        platform: "Slack",
        channel: "engineering",
      },
      {
        person: "User I",
        content:
          "User G, don't forget about the Q1 architecture redesign proposal. Due in 3 weeks.",
        time: "2024-11-25T14:05:00Z",
        platform: "Email",
        channel: "planning",
      },
    ],
    expected: {
      urgency: "immediate",
      importance: "high",
      myTasksCount: 2,
      waitingForOthersCount: 0,
    },
  },
  // ========== VIP / Importance Dimension ==========
  {
    id: "issue-45-ceo-request-high-priority",
    name: "CEO Request (VIP - High Priority)",
    description:
      "Request from CEO/founder. Should automatically get high priority regardless of content.",
    extraInfo:
      "If the message is from CEO or company founder, assign high priority to the task.",
    category: "G1",
    priority: "P1",
    userProfile: {
      name: "User J",
      email: "user.j@example.com",
    },
    messages: [
      {
        person: "CEO | Company Founder",
        content:
          "User J, can you pull together the investor metrics for our board meeting next week?",
        time: "2024-11-25T11:00:00Z",
        platform: "Email",
        channel: "executive",
      },
    ],
    expected: {
      urgency: "24h",
      importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-46-key-client-urgent",
    name: "Key Client Request (VIP - Urgent)",
    description:
      "Request from major client. Should be treated as urgent and important.",
    category: "G1",
    priority: "P1",
    userProfile: {
      name: "CiCi",
      email: "user.k@example.com",
    },
    messages: [
      {
        person: "Enterprise Client | Fortune 500",
        content:
          "CiCi, we're experiencing issues with the API integration. Our production deployment is blocked. Need immediate support.",
        time: "2024-11-25T16:00:00Z",
        platform: "Email",
        channel: "enterprise-support",
      },
    ],
    expected: {
      urgency: "immediate",
      importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-47-investor-request",
    name: "Investor Request (VIP - Important)",
    description:
      "Request from investor. Should be important but not necessarily urgent.",
    category: "G1",
    priority: "P1",
    userProfile: {
      name: "CiCi",
      email: "user.l@example.com",
    },
    messages: [
      {
        person: "Lead Investor | VC Partner",
        content:
          "CiCi, I'd like to schedule a call to discuss the growth metrics and burn rate. How about sometime next week?",
        time: "2024-11-25T10:00:00Z",
        platform: "Email",
        channel: "investor-relations",
      },
    ],
    expected: {
      urgency: "24h",
      importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-48-junior-vs-senior-request",
    name: "Junior vs Senior Request Priority",
    description:
      "Similar requests from junior and senior staff. AI should weigh seniority appropriately.",
    category: "G1",
    priority: "P2",
    userProfile: {
      name: "User M",
      email: "user.m@example.com",
    },
    messages: [
      {
        person: "Intern | New Hire",
        content:
          "User M, when you have time, could you review my code? No rush.",
        time: "2024-11-25T09:00:00Z",
        platform: "Slack",
        channel: "engineering",
      },
      {
        person: "CTO | Engineering Lead",
        content:
          "User M, need your input on the security architecture before we finalize the design.",
        time: "2024-11-25T09:30:00Z",
        platform: "Slack",
        channel: "engineering",
      },
    ],
    expected: {
      // urgency: "24h",
      // importance: "high",
      myTasksCount: 2,
      waitingForOthersCount: 0,
    },
  },
  // ========== 1-on-1 vs Group Chat Dimension ==========
  {
    id: "issue-49-dm-personal-request",
    name: "DM Personal Request (1-on-1 - Should Accept)",
    description:
      "Direct message with personal request. Should generate task even without explicit @mention.",
    category: "B1",
    priority: "P1",
    userProfile: {
      name: "User N",
      email: "user.n@example.com",
    },
    messages: [
      {
        person: "User O",
        content:
          "Hey, can you help me debug this issue? I've been stuck for hours.",
        time: "2024-11-25T15:00:00Z",
        platform: "Slack DM",
        channel: "direct-message",
      },
    ],
    expected: {
      // urgency: "24h",
      importance: "medium",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-50-group-no-mention-no-task",
    name: "Group Chat No Mention (Should NOT Generate Task)",
    description:
      "General question in group without @mention. Should NOT create task for user.",
    category: "A1",
    priority: "P0",
    userProfile: {
      name: "User P",
      email: "user.p@example.com",
    },
    messages: [
      {
        person: "User Q",
        content:
          "Does anyone know how to configure the load balancer for multi-region deployment?",
        time: "2024-11-25T13:00:00Z",
        platform: "Discord",
        channel: "infrastructure",
      },
    ],
    expected: {
      urgency: "not_urgent",
      myTasksCount: 0,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-51-group-explicit-mention",
    name: "Group Chat with Explicit @Mention (Should Generate Task)",
    description:
      "Group chat with explicit @mention. Should generate task for mentioned user.",
    category: "F2",
    priority: "P1",
    userProfile: {
      name: "User R",
      email: "user.r@example.com",
    },
    messages: [
      {
        person: "User S",
        content:
          "@User R can you take a look at the database performance issue today? Queries are timing out.",
        time: "2024-11-25T14:30:00Z",
        platform: "Slack",
        channel: "backend-team",
      },
    ],
    expected: {
      // urgency: "24h",
      // importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-52-group-reply-thread",
    name: "Group Reply in Thread (Context-Aware Assignment)",
    description:
      "Reply in thread context. AI should understand user is part of conversation.",
    category: "F2",
    priority: "P1",
    userProfile: {
      name: "User T",
      email: "user.t@example.com",
    },
    messages: [
      {
        person: "User U",
        content: "We need to update the API documentation before the release.",
        time: "2024-11-25T10:00:00Z",
        platform: "Slack",
        channel: "product",
      },
      {
        person: "User T",
        content: "I can handle the API docs. What's the deadline?",
        time: "2024-11-25T10:05:00Z",
        platform: "Slack",
        channel: "product",
      },
      {
        person: "User U",
        content: "Great! Need it by Thursday. Thanks!",
        time: "2024-11-25T10:10:00Z",
        platform: "Slack",
        channel: "product",
      },
    ],
    expected: {
      urgency: "24h",
      importance: "medium",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  // ========== Context Dependency Dimension ==========
  {
    id: "issue-53-pronoun-resolution",
    name: "Pronoun Resolution (Context Understanding)",
    description:
      "Message uses pronouns. AI should resolve 'it', 'this', 'that' from context.",
    category: "H1",
    priority: "P1",
    userProfile: {
      name: "User V",
      email: "user.v@example.com",
    },
    messages: [
      {
        person: "User W",
        content: "The payment gateway integration is failing in staging.",
        time: "2024-11-25T11:00:00Z",
        platform: "Slack",
        channel: "engineering",
      },
      {
        person: "User W",
        content: "User V, can you fix this today? It's blocking QA testing.",
        time: "2024-11-25T11:05:00Z",
        platform: "Slack",
        channel: "engineering",
      },
    ],
    expected: {
      // urgency: "immediate",
      importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-54-implicit-dependency",
    name: "Implicit Dependency Chain",
    description:
      "Task depends on another task. AI should understand dependency relationship.",
    category: "H2",
    priority: "P1",
    userProfile: {
      name: "User X",
      email: "user.x@example.com",
    },
    messages: [
      {
        person: "User Y",
        content: "User Z will finish the API endpoints by tomorrow.",
        time: "2024-11-25T09:00:00Z",
        platform: "Slack",
        channel: "development",
      },
      {
        person: "User Y",
        content:
          "User X, once that's done, you can start the frontend integration.",
        time: "2024-11-25T09:05:00Z",
        platform: "Slack",
        channel: "development",
      },
    ],
    expected: {
      urgency: "24h",
      importance: "medium",
      myTasksCount: 1,
      waitingForOthersCount: 1,
    },
  },
  {
    id: "issue-55-conditional-task",
    name: "Conditional Task (If-Then Logic)",
    description: "Task has conditional logic. AI should capture the condition.",
    category: "H3",
    priority: "P1",
    userProfile: {
      name: "User AA",
      email: "user.aa@example.com",
    },
    messages: [
      {
        person: "User BB",
        content:
          "User AA, if the test results come back positive, please proceed with the production deployment today. Otherwise, hold off and let me know.",
        time: "2024-11-25T14:00:00Z",
        platform: "Email",
        channel: "devops",
      },
    ],
    expected: {
      // urgency: "24h",
      // importance: "medium",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-56-multi-step-task",
    name: "Multi-Step Task Breakdown",
    description:
      "Single message contains multiple sequential steps. AI should recognize as one task with subtasks.",
    category: "H4",
    priority: "P1",
    userProfile: {
      name: "User CC",
      email: "user.cc@example.com",
    },
    messages: [
      {
        person: "User DD",
        content:
          "User CC, for the launch: 1) Update the landing page copy, 2) Set up the analytics tracking, 3) Configure the email automation. Need all done by Friday.",
        time: "2024-11-25T10:00:00Z",
        platform: "Slack",
        channel: "marketing",
      },
    ],
    expected: {
      urgency: "24h",
      importance: "high",
      myTasksCount: 3,
      waitingForOthersCount: 0,
    },
  },
  // ========== Multi-Party Coordination Dimension ==========
  {
    id: "issue-57-delegation-chain",
    name: "Delegation Chain (A asks B to ask C)",
    description:
      "User is asked to delegate to someone else. Should create task for user, not final person.",
    category: "I1",
    priority: "P1",
    userProfile: {
      name: "User EE",
      email: "user.ee@example.com",
    },
    messages: [
      {
        person: "User FF",
        content:
          "User EE, can you ask the design team to create mockups for the new feature? We need them by next week.",
        time: "2024-11-25T11:00:00Z",
        platform: "Slack",
        channel: "product",
      },
    ],
    expected: {
      // urgency: "24h",
      importance: "medium",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-58-collaborative-task",
    name: "Collaborative Task (Multiple Assignees)",
    description: "Task assigned to multiple people. Each should get the task.",
    category: "I2",
    priority: "P1",
    userProfile: {
      name: "User GG",
      email: "user.gg@example.com",
    },
    messages: [
      {
        person: "User HH",
        content:
          "@User GG @User II can you both review the security audit report and provide feedback by EOD?",
        time: "2024-11-25T13:00:00Z",
        platform: "Slack",
        channel: "security",
      },
    ],
    expected: {
      // urgency: "24h",
      // importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-59-handoff-task",
    name: "Task Handoff (From A to B)",
    description:
      "Task is being handed off from one person to another. New assignee should get it.",
    category: "I3",
    priority: "P2",
    userProfile: {
      name: "User JJ",
      email: "user.jj@example.com",
    },
    messages: [
      {
        person: "User KK",
        content:
          "I'm going on vacation next week. User JJ, can you take over the client onboarding for Acme Corp?",
        time: "2024-11-25T15:00:00Z",
        platform: "Email",
        channel: "customer-success",
      },
    ],
    expected: {
      // urgency: "24h",
      // importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-60-escalation-to-manager",
    name: "Escalation to Manager (Blocked Task)",
    description:
      "User is blocked and escalates to manager. Manager should get the task.",
    category: "I4",
    priority: "P1",
    userProfile: {
      name: "Manager",
      email: "manager@example.com",
    },
    messages: [
      {
        person: "User LL",
        content:
          "@Manager I'm blocked on the database migration. Need admin access to production. Can you help?",
        time: "2024-11-25T16:30:00Z",
        platform: "Slack",
        channel: "engineering",
      },
    ],
    expected: {
      urgency: "immediate",
      importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  // ========== P0: Category B - Role-Based - Immediate ==========
  {
    id: "issue-61-role-immediate-dm-ops",
    name: "Immediate Role Assignment - DM Ops (1-on-1)",
    description:
      "User declares ops role in DM, immediately receives server issue. Should generate urgent task.",
    category: "B1",
    priority: "P0",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
    },
    messages: [
      {
        person: "User A",
        content:
          "Just FYI, I'm the DevOps engineer for Project Delta, so reach out if there are any infrastructure issues.",
        time: "2024-11-25T10:00:00Z",
        platform: "Slack DM",
        channel: "direct-message",
      },
      {
        person: "User B",
        content:
          "Oh perfect timing! The production database is running out of disk space. Can you check?",
        time: "2024-11-25T10:05:00Z",
        platform: "Slack DM",
        channel: "direct-message",
      },
    ],
    expected: {
      urgency: "immediate",
      importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-62-role-immediate-group-pm",
    name: "Immediate Role Assignment - Group PM",
    description:
      "User declares PM role in group, immediately receives feature request. Should generate important task.",
    extraInfo:
      "I'm the product manager for the mobile app. When someone ask questions about the product, assign me tasks",
    category: "B1",
    priority: "P0",
    userProfile: {
      name: "User C",
      email: "user.c@example.com",
    },
    messages: [
      {
        person: "User D",
        content:
          "Great! Can we add dark mode support? Users have been requesting this for months.",
        time: "2024-11-25T14:10:00Z",
        platform: "Discord",
        channel: "product-feedback",
      },
    ],
    expected: {
      // urgency: "24h",
      // importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-63-role-immediate-group-tech-lead",
    name: "Immediate Role Assignment - Group Tech Lead",
    description:
      "User declares tech lead role in group, immediately receives architecture question.",
    category: "B1",
    priority: "P0",
    userProfile: {
      name: "User E",
      email: "user.e@example.com",
    },
    messages: [
      {
        person: "User E",
        content:
          "I'm the tech lead for the backend team. Happy to answer any architecture or design questions.",
        time: "2024-11-25T11:00:00Z",
        platform: "Slack",
        channel: "engineering",
      },
      {
        person: "User F",
        content:
          "Perfect! What's your recommendation for handling real-time notifications - WebSockets or Server-Sent Events?",
        time: "2024-11-25T11:15:00Z",
        platform: "Slack",
        channel: "engineering",
      },
    ],
    expected: {
      // urgency: "24h",
      // importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-64-role-immediate-dm-community",
    name: "Immediate Role Assignment - DM Community Manager",
    description:
      "User declares community manager role in DM, immediately receives event question.",
    extraInfo:
      "I'm now the community manager for Project Epsilon. I handle events and community programs as high priority things",
    category: "B1",
    priority: "P0",
    userProfile: {
      name: "User G",
      email: "user.g@example.com",
    },
    messages: [
      {
        person: "User H",
        content:
          "Awesome! Can you organize a hackathon next month? Our developer community is really active.",
        time: "2024-11-25T09:20:00Z",
        platform: "Telegram DM",
        channel: "direct-message",
      },
    ],
    expected: {
      // urgency: "not_urgent",
      importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-65-role-immediate-group-security",
    name: "Immediate Role Assignment - Group Security Lead",
    description:
      "User declares security role in group, immediately receives security concern.",
    category: "B1",
    priority: "P0",
    userProfile: {
      name: "User I",
      email: "user.i@example.com",
    },
    messages: [
      {
        person: "User I",
        content:
          "I'm the security lead. Please report any vulnerabilities or security concerns to me.",
        time: "2024-11-25T15:00:00Z",
        platform: "Slack",
        channel: "security",
      },
      {
        person: "User J",
        content:
          "Found a potential SQL injection vulnerability in the user search endpoint. Should I create a ticket?",
        time: "2024-11-25T15:10:00Z",
        platform: "Slack",
        channel: "security",
      },
    ],
    expected: {
      // urgency: "immediate",
      importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-66-role-immediate-dm-support",
    name: "Immediate Role Assignment - DM Support Lead",
    description:
      "User declares support role in DM, immediately receives customer issue.",
    category: "B1",
    priority: "P0",
    userProfile: {
      name: "User K",
      email: "user.k@example.com",
    },
    messages: [
      {
        person: "User K",
        content:
          "I'm leading customer support now. Forward any urgent customer issues to me.",
        time: "2024-11-25T13:00:00Z",
        platform: "Email",
        channel: "direct-email",
      },
      {
        person: "User L",
        content:
          "Great! We have an enterprise client (Fortune 100) experiencing login failures. They're threatening to churn.",
        time: "2024-11-25T13:30:00Z",
        platform: "Email",
        channel: "direct-email",
      },
    ],
    expected: {
      urgency: "immediate",
      importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-67-role-immediate-group-data",
    name: "Immediate Role Assignment - Group Data Engineer",
    description:
      "User declares data engineer role in group, immediately receives data pipeline question.",
    category: "B1",
    priority: "P0",
    userProfile: {
      name: "User M",
      email: "user.m@example.com",
    },
    messages: [
      {
        person: "User M",
        content:
          "I'm the data engineer for analytics. Let me know if you need help with data pipelines or ETL.",
        time: "2024-11-25T10:30:00Z",
        platform: "Discord",
        channel: "data-team",
      },
      {
        person: "User N",
        content:
          "The daily ETL job is failing with timeout errors. Can you investigate?",
        time: "2024-11-25T10:45:00Z",
        platform: "Discord",
        channel: "data-team",
      },
    ],
    expected: {
      // urgency: "immediate",
      importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-68-role-immediate-group-design",
    name: "Immediate Role Assignment - Group Design Lead",
    description:
      "User declares design lead role in group, immediately receives design request.",
    category: "B1",
    priority: "P0",
    userProfile: {
      name: "User O",
      email: "user.o@example.com",
    },
    messages: [
      {
        person: "User O",
        content:
          "I'm the design lead. Ping me for UI/UX reviews or design system questions.",
        time: "2024-11-25T16:00:00Z",
        platform: "Slack",
        channel: "design",
      },
      {
        person: "User P",
        content:
          "Can you review the new onboarding flow mockups? Need feedback before we start development.",
        time: "2024-11-25T16:20:00Z",
        platform: "Slack",
        channel: "design",
      },
    ],
    expected: {
      // urgency: "24h",
      // importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-69-role-immediate-dm-legal",
    name: "Immediate Role Assignment - DM Legal Counsel",
    description:
      "User declares legal role in DM, immediately receives contract question.",
    category: "B1",
    priority: "P0",
    userProfile: {
      name: "User Q",
      email: "user.q@example.com",
    },
    messages: [
      {
        person: "User Q",
        content:
          "I'm the legal counsel for the company. Route any contract or compliance questions to me.",
        time: "2024-11-25T11:00:00Z",
        platform: "Email",
        channel: "direct-email",
      },
      {
        person: "User R",
        content:
          "Need your review on the enterprise SLA agreement. Client wants to sign by Friday.",
        time: "2024-11-25T11:30:00Z",
        platform: "Email",
        channel: "direct-email",
      },
    ],
    expected: {
      urgency: "24h",
      importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-70-role-immediate-group-qa",
    name: "Immediate Role Assignment - Group QA Lead",
    description:
      "User declares QA lead role in group, immediately receives testing request.",
    category: "B1",
    priority: "P0",
    userProfile: {
      name: "User S",
      email: "user.s@example.com",
    },
    messages: [
      {
        person: "User S",
        content:
          "I'm the QA lead. Tag me for test coverage questions or release testing.",
        time: "2024-11-25T14:00:00Z",
        platform: "Slack",
        channel: "quality",
      },
      {
        person: "User T",
        content:
          "We're releasing v2.0 next week. Can you coordinate the regression testing?",
        time: "2024-11-25T14:15:00Z",
        platform: "Slack",
        channel: "quality",
      },
    ],
    expected: {
      urgency: "24h",
      // importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  // ========== P0: Role Mismatch ==========
  {
    id: "issue-71-role-mismatch-ops-marketing",
    name: "Role Mismatch - Ops Receives Marketing (Should Ignore)",
    description:
      "User is ops, receives marketing question. Should NOT generate task or lower priority significantly.",
    category: "J1",
    priority: "P0",
    userProfile: {
      name: "User U",
      email: "user.u@example.com",
    },
    messages: [
      {
        person: "User U",
        content: "I'm the DevOps engineer for Project Zeta.",
        time: "2024-11-01T10:00:00Z",
        platform: "Slack",
        channel: "general",
      },
      {
        person: "User V",
        content:
          "Hey team, what's our social media strategy for the product launch? Should we focus on Twitter or LinkedIn?",
        time: "2024-11-20T15:00:00Z",
        platform: "Slack",
        channel: "general",
      },
    ],
    expected: {
      urgency: "not_urgent",
      myTasksCount: 0,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-72-role-mismatch-pm-infrastructure",
    name: "Role Mismatch - PM Receives Infrastructure (Should Ignore/Lower Priority)",
    description:
      "User is PM, receives low-level infrastructure question. Should NOT generate task.",
    category: "J1",
    priority: "P0",
    userProfile: {
      name: "User W",
      email: "user.w@example.com",
    },
    messages: [
      {
        person: "User W",
        content: "I'm the product manager for the mobile app.",
        time: "2024-11-05T09:00:00Z",
        platform: "Discord",
        channel: "product",
      },
      {
        person: "User X",
        content:
          "Should we use Kubernetes or Docker Swarm for container orchestration? Need to decide on the infrastructure stack.",
        time: "2024-11-22T11:00:00Z",
        platform: "Discord",
        channel: "product",
      },
    ],
    expected: {
      urgency: "not_urgent",
      myTasksCount: 0,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-73-role-mismatch-dev-sales",
    name: "Role Mismatch - Developer Receives Sales Question (Should Ignore)",
    description:
      "User is developer, receives sales/pricing question. Should NOT generate task.",
    category: "J1",
    priority: "P0",
    userProfile: {
      name: "User Y",
      email: "user.y@example.com",
    },
    messages: [
      {
        person: "User Y",
        content: "I'm a backend developer working on the API.",
        time: "2024-11-10T14:00:00Z",
        platform: "Slack",
        channel: "engineering",
      },
      {
        person: "User Z",
        content:
          "What's our pricing model for enterprise customers? Prospect is asking about volume discounts.",
        time: "2024-11-24T16:00:00Z",
        platform: "Slack",
        channel: "engineering",
      },
    ],
    expected: {
      urgency: "not_urgent",
      myTasksCount: 0,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-74-role-mismatch-designer-database",
    name: "Role Mismatch - Designer Receives Database Question (Should Ignore)",
    description:
      "User is designer, receives database optimization question. Should NOT generate task.",
    category: "J1",
    priority: "P0",
    userProfile: {
      name: "User AA",
      email: "user.aa@example.com",
    },
    messages: [
      {
        person: "User AA",
        content: "I'm the UI/UX designer for the platform.",
        time: "2024-11-08T10:00:00Z",
        platform: "Discord",
        channel: "design",
      },
      {
        person: "User BB",
        content:
          "Should we use PostgreSQL or MongoDB for the new microservice? Need to optimize for read-heavy workloads.",
        time: "2024-11-23T13:00:00Z",
        platform: "Discord",
        channel: "design",
      },
    ],
    expected: {
      urgency: "not_urgent",
      myTasksCount: 0,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-75-role-mismatch-community-technical",
    name: "Role Mismatch - Community Manager Receives Deep Technical (Should Ignore)",
    description:
      "User is community manager, receives deep technical implementation question. Should NOT generate task.",
    category: "J1",
    priority: "P0",
    userProfile: {
      name: "User CC",
      email: "user.cc@example.com",
    },
    messages: [
      {
        person: "User CC",
        content:
          "I'm the community manager. I organize events and manage social channels.",
        time: "2024-11-12T15:00:00Z",
        platform: "Telegram",
        channel: "community",
      },
      {
        person: "User DD",
        content:
          "How should we implement the consensus mechanism for our Layer 2 solution? Optimistic rollups or ZK-rollups?",
        time: "2024-11-25T10:00:00Z",
        platform: "Telegram",
        channel: "community",
      },
    ],
    expected: {
      urgency: "not_urgent",
      myTasksCount: 0,
      waitingForOthersCount: 0,
    },
  },
  // ========== P0: Broadcast with Role Match ==========
  {
    id: "issue-76-broadcast-role-match-ops-urgent",
    name: "Broadcast + Role Match - Ops + Server Alert (Should Generate Urgent)",
    description:
      "Broadcast server alert in group. User is ops, should receive urgent task despite broadcast nature.",
    category: "G2",
    priority: "P0",
    userProfile: {
      name: "User EE",
      email: "user.ee@example.com",
    },
    messages: [
      {
        person: "User EE",
        content: "I'm the DevOps engineer for all production systems.",
        time: "2024-11-01T09:00:00Z",
        platform: "Slack",
        channel: "infrastructure",
      },
      {
        person: "Monitoring Bot",
        content:
          "🚨 ALERT: Production API server CPU usage at 95%. Response times degrading. Immediate attention required.",
        time: "2024-11-25T18:00:00Z",
        platform: "Slack",
        channel: "infrastructure",
      },
    ],
    expected: {
      urgency: "immediate",
      importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-77-broadcast-role-match-pm-feature",
    name: "Broadcast + Role Match - PM + Feature Request (Should Generate Important)",
    description:
      "Broadcast feature request in group. User is PM, should receive important task.",
    extraInfo:
      "I'm the product manager for the web platform. When someone task product features, assign me high priority tasks make importance high",
    category: "G3",
    priority: "P1",
    userProfile: {
      name: "User FF",
      email: "user.ff@example.com",
    },
    messages: [
      {
        person: "User GG",
        content:
          "Team announcement: Top 3 user-requested features are: 1) Bulk export, 2) Advanced filters, 3) Mobile app. Let's prioritize!",
        time: "2024-11-24T14:00:00Z",
        platform: "Discord",
        channel: "product-feedback",
      },
    ],
    expected: {
      // urgency: "24h",
      importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-78-broadcast-role-match-security-vuln",
    name: "Broadcast + Role Match - Security + Vulnerability (Should Generate Urgent)",
    description:
      "Broadcast security vulnerability. User is security lead, should receive urgent task.",
    extraInfo:
      "I'm the security lead. Report all vulnerabilities to this channel. When occurs security issues, assign me high priority tasks make importance high.",
    category: "G2",
    priority: "P0",
    userProfile: {
      name: "User HH",
      email: "user.hh@example.com",
    },
    messages: [
      {
        person: "Security Scanner Bot",
        content:
          "⚠️ Critical vulnerability detected: CVE-2024-12345 affects our authentication library. CVSS score: 9.8. Patch available.",
        time: "2024-11-25T09:00:00Z",
        platform: "Slack",
        channel: "security",
      },
    ],
    expected: {
      urgency: "immediate",
      importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-79-broadcast-role-mismatch-ignore",
    name: "Broadcast + Role Mismatch - Dev + Marketing (Should Ignore)",
    description:
      "Broadcast marketing announcement. User is developer, should NOT receive task.",
    category: "A1",
    priority: "P0",
    userProfile: {
      name: "User II",
      email: "user.ii@example.com",
    },
    messages: [
      {
        person: "User II",
        content: "I'm a frontend developer working on the UI.",
        time: "2024-11-07T10:00:00Z",
        platform: "Slack",
        channel: "general",
      },
      {
        person: "Marketing Team",
        content:
          "📢 Announcement: We're launching a social media campaign next week! Follow us on Twitter, LinkedIn, and Instagram for updates!",
        time: "2024-11-25T15:00:00Z",
        platform: "Slack",
        channel: "general",
      },
    ],
    expected: {
      urgency: "not_urgent",
      myTasksCount: 0,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-80-broadcast-role-match-support-outage",
    name: "Broadcast + Role Match - Support + Outage (Should Generate Urgent)",
    description:
      "Broadcast service outage. User is support lead, should receive urgent task to handle customer communications.",
    extraInfo:
      "I'm the customer support lead. I handle all customer communications during incidents. When events occru, assign me tasks",
    category: "G2",
    priority: "P0",
    userProfile: {
      name: "User JJ",
      email: "user.jj@example.com",
    },
    messages: [
      {
        person: "Incident Bot",
        content:
          "🔴 INCIDENT: Payment processing is down. Affecting 50% of transactions. Customer tickets flooding in.",
        time: "2024-11-25T16:30:00Z",
        platform: "Slack",
        channel: "support",
      },
    ],
    expected: {
      urgency: "immediate",
      importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  // ========== P1: Cross-Channel Deduplication - Enhanced ==========
  {
    id: "issue-81-cross-channel-triple-platform",
    name: "Cross-Channel Triple Platform (Should Merge into ONE)",
    description:
      "Same task mentioned across Slack, Email, and Discord. AI should split multiple task.",
    category: "E1",
    priority: "P1",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
    },
    messages: [
      {
        person: "User B",
        content:
          "User A, can you prepare the investor deck for the Series A pitch?",
        time: "2024-11-25T09:00:00Z",
        platform: "Slack",
        channel: "fundraising",
      },
      {
        person: "User B",
        content:
          "Hi User A, following up on the investor deck. Need it by Friday for the VC meeting.",
        time: "2024-11-25T14:00:00Z",
        platform: "Email",
        channel: "fundraising-team",
      },
      {
        person: "User B",
        content:
          "User A - reminder about the Series A pitch deck. Let me know if you need any data.",
        time: "2024-11-25T18:00:00Z",
        platform: "Discord",
        channel: "exec-team",
      },
    ],
    expected: {
      urgency: "24h",
      importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-82-cross-channel-long-timespan",
    name: "Cross-Channel Long Timespan Follow-up (Should Merge)",
    description:
      "Initial request + follow-up after 1 week. AI should recognize as same task.",
    category: "E1",
    priority: "P1",
    userProfile: {
      name: "User C",
      email: "user.c@example.com",
    },
    messages: [
      {
        person: "User D",
        content:
          "User C, please review the API documentation when you get a chance.",
        time: "2024-11-18T10:00:00Z",
        platform: "Slack",
        channel: "engineering",
      },
      {
        person: "User D",
        content:
          "Hey User C, just checking in on the API documentation review. Any updates?",
        time: "2024-11-25T15:00:00Z",
        platform: "Email",
        channel: "engineering-team",
      },
    ],
    expected: {
      // urgency: "not_urgent",
      // importance: "medium",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-83-cross-channel-different-wording",
    name: "Cross-Channel Different Wording (Should Merge)",
    description:
      "Same task with different wording across platforms. AI should recognize semantic similarity.",
    extraInfo:
      "Same task with different wording across platforms. You should recognize semantic similarity and merge them.",
    category: "E1",
    priority: "P1",
    userProfile: {
      name: "User E",
      email: "user.e@example.com",
    },
    messages: [
      {
        person: "User F",
        content: "User E, we need to fix the payment gateway integration bug.",
        time: "2024-11-25T11:00:00Z",
        platform: "Slack",
        channel: "backend",
      },
      {
        person: "User F",
        content:
          "User E, can you resolve the issue with the checkout payment processing?",
        time: "2024-11-25T16:00:00Z",
        platform: "Email",
        channel: "backend-team",
      },
    ],
    expected: {
      // urgency: "immediate",
      // importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-84-cross-channel-escalation",
    name: "Cross-Channel Escalation (Should Merge + Update Priority)",
    description:
      "Initial request + escalation. AI should merge and update urgency.",
    category: "E1",
    priority: "P1",
    userProfile: {
      name: "User G",
      email: "user.g@example.com",
    },
    messages: [
      {
        person: "User H",
        content:
          "User G, please update the user onboarding flow when you have time.",
        time: "2024-11-24T10:00:00Z",
        platform: "Slack",
        channel: "product",
      },
      {
        person: "User H",
        content:
          "User G - URGENT: The onboarding flow update is now blocking the release. Need it ASAP!",
        time: "2024-11-25T14:00:00Z",
        platform: "Email",
        channel: "product-team",
      },
    ],
    expected: {
      urgency: "immediate",
      importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-85-cross-channel-partial-completion",
    name: "Cross-Channel Partial Completion Update (Should Merge)",
    description:
      "Task with progress update. AI should merge and recognize partial completion.",
    category: "E2",
    priority: "P1",
    userProfile: {
      name: "User I",
      email: "user.i@example.com",
    },
    messages: [
      {
        person: "User J",
        content: "User I, can you migrate the database to the new schema?",
        time: "2024-11-23T09:00:00Z",
        platform: "Slack",
        channel: "data",
      },
      {
        person: "User I",
        content:
          "I've completed 60% of the database migration. Should finish by tomorrow.",
        time: "2024-11-25T11:00:00Z",
        platform: "Slack",
        channel: "data",
      },
      {
        person: "User J",
        content:
          "Thanks for the update on the DB migration. Let me know when it's fully done.",
        time: "2024-11-25T15:00:00Z",
        platform: "Email",
        channel: "data-team",
      },
    ],
    expected: {
      // urgency: "24h",
      // importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  // ========== P1: Time Parameter Accuracy - Enhanced ==========
  {
    id: "issue-86-relative-time-next-week",
    name: "Relative Time - Next Week (Should Parse Correctly)",
    description:
      "Task with relative time 'next week'. AI should calculate specific deadline.",
    category: "D1",
    priority: "P1",
    userProfile: {
      name: "User K",
      email: "user.k@example.com",
    },
    messages: [
      {
        person: "User L",
        content: "User K, please submit the expense report by next week.",
        time: "2024-11-25T10:00:00Z",
        platform: "Email",
        channel: "finance",
      },
    ],
    expected: {
      // urgency: "not_urgent",
      // importance: "medium",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-87-relative-time-end-of-month",
    name: "Relative Time - End of Month (Should Parse Correctly)",
    description:
      "Task with 'end of month' deadline. AI should calculate specific date.",
    category: "D1",
    priority: "P1",
    userProfile: {
      name: "User M",
      email: "user.m@example.com",
    },
    messages: [
      {
        person: "User N",
        content:
          "User M, we need the monthly financial report by end of month.",
        time: "2024-11-25T14:00:00Z",
        platform: "Slack",
        channel: "finance",
      },
    ],
    expected: {
      // urgency: "24h",
      // importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-88-timezone-conflict-resolution",
    name: "Timezone Conflict Resolution (Should Handle Correctly)",
    description:
      "Task mentions conflicting timezones. AI should resolve correctly.",
    category: "D1",
    priority: "P1",
    userProfile: {
      name: "User O",
      email: "user.o@example.com",
    },
    messages: [
      {
        person: "User P",
        content:
          "User O, deploy the update by 9am PST tomorrow. That's 5pm GMT for our London team.",
        time: "2024-11-25T20:00:00Z",
        platform: "Slack",
        channel: "devops",
      },
    ],
    expected: {
      // urgency: "immediate",
      // importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-89-multiple-overdue-tasks",
    name: "Multiple Overdue Tasks (Should Prioritize Correctly)",
    description:
      "Multiple overdue tasks with different severity. AI should prioritize correctly.",
    category: "D1",
    priority: "P1",
    userProfile: {
      name: "User Q",
      email: "user.q@example.com",
    },
    messages: [
      {
        person: "User R",
        content:
          "User Q, the client presentation was due yesterday. They're waiting!",
        time: "2024-11-26T09:00:00Z",
        platform: "Email",
        channel: "sales",
      },
      {
        person: "User S",
        content:
          "User Q, reminder - the team meeting notes from last week are still pending.",
        time: "2024-11-26T09:30:00Z",
        platform: "Slack",
        channel: "general",
      },
    ],
    expected: {
      urgency: "immediate",
      importance: "high",
      myTasksCount: 2,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-90-business-days-vs-calendar-days",
    name: "Business Days vs Calendar Days (Should Distinguish)",
    description:
      "Task specifies business days. AI should account for weekends.",
    category: "D1",
    priority: "P2",
    userProfile: {
      name: "User T",
      email: "user.t@example.com",
    },
    messages: [
      {
        person: "User U",
        content:
          "User T, please complete the code review within 3 business days. Today is Friday.",
        time: "2024-11-22T16:00:00Z",
        platform: "GitHub",
        channel: "pull-requests",
      },
    ],
    expected: {
      urgency: "24h",
      importance: "medium",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  // ========== P1: Parameter Edge Cases ==========
  {
    id: "issue-91-extreme-vague-description",
    name: "Extreme Vague Description (Should Still Capture)",
    description:
      "Task with extremely vague description. AI should capture but flag for clarification.",
    category: "A1",
    priority: "P1",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
    },
    messages: [
      {
        person: "User B",
        content:
          "User A, can you handle that thing we discussed? You know what I mean.",
        time: "2024-11-25T10:00:00Z",
        platform: "Slack",
        channel: "project-alpha",
      },
    ],
    expected: {
      // urgency: "24h",
      importance: "medium",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-92-complex-assignee-inference",
    name: "Complex Assignee Inference (Should Infer Correctly)",
    description:
      "Multiple people mentioned, AI should infer correct assignee from context.",
    category: "A2",
    priority: "P1",
    userProfile: {
      name: "User C",
      email: "user.c@example.com",
    },
    messages: [
      {
        person: "User D",
        content:
          "We need someone to review the security audit. User E is on vacation, User F is swamped. User C, you're the most familiar with the codebase, can you take this?",
        time: "2024-11-25T14:00:00Z",
        platform: "Slack",
        channel: "security",
      },
    ],
    expected: {
      urgency: "24h",
      importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-93-multi-condition-task",
    name: "Multi-Condition Task (Complex If-Then-Else)",
    description:
      "Task with multiple nested conditions. AI should capture all conditions.",
    category: "H3",
    priority: "P1",
    userProfile: {
      name: "User G",
      email: "user.g@example.com",
    },
    messages: [
      {
        person: "User H",
        content:
          "User G, if the API tests pass, deploy to staging. If staging looks good after 2 hours, promote to production. But if any errors occur, rollback immediately and notify the team.",
        time: "2024-11-25T16:00:00Z",
        platform: "Slack",
        channel: "devops",
      },
    ],
    expected: {
      // urgency: "immediate",
      // importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  // ========== P1: Multi-Party Collaboration - Complex ==========
  {
    id: "issue-94-circular-dependency",
    name: "Circular Dependency Detection (Should Flag)",
    description:
      "Task A waits for B, B waits for A. AI should detect circular dependency.",
    category: "H2",
    priority: "P2",
    userProfile: {
      name: "User I",
      email: "user.i@example.com",
    },
    messages: [
      {
        person: "User J",
        content:
          "User I, I can't finish the frontend until you provide the API endpoints.",
        time: "2024-11-25T10:00:00Z",
        platform: "Slack",
        channel: "development",
      },
      {
        person: "User I",
        content:
          "User J, I need the UI mockups finalized before I can design the API schema.",
        time: "2024-11-25T10:30:00Z",
        platform: "Slack",
        channel: "development",
      },
    ],
    expected: {
      // urgency: "immediate",
      // importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 1,
    },
  },
  {
    id: "issue-95-multi-layer-delegation",
    name: "Multi-Layer Delegation Chain (A→B→C→D)",
    description:
      "Complex delegation chain. AI should track the chain correctly.",
    category: "H4",
    priority: "P1",
    userProfile: {
      name: "User K",
      email: "user.k@example.com",
    },
    messages: [
      {
        person: "CEO",
        content:
          "User K, please coordinate with the legal team to get the contract reviewed, then have finance approve the budget, and finally get engineering to sign off on the technical feasibility.",
        time: "2024-11-25T09:00:00Z",
        platform: "Email",
        channel: "executive",
      },
    ],
    expected: {
      // urgency: "24h",
      // importance: "high",
      myTasksCount: 3,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-96-parallel-collaboration",
    name: "Parallel Collaboration (Multiple People, Same Task)",
    description:
      "Multiple people working on different parts of same task. AI should recognize as one collaborative task.",
    category: "I2",
    priority: "P1",
    userProfile: {
      name: "User M",
      email: "user.m@example.com",
    },
    messages: [
      {
        person: "User N",
        content:
          "@User M @User O @User P - We need to launch the new feature by Friday. User M handles backend, User O handles frontend, User P handles testing. Let's sync daily.",
        time: "2024-11-25T10:00:00Z",
        platform: "Slack",
        channel: "product-launch",
      },
    ],
    expected: {
      urgency: "24h",
      importance: "high",
      myTasksCount: 2,
      waitingForOthersCount: 0,
    },
  },
  // ========== P1: Comprehensive Combined Scenarios ==========
  {
    id: "issue-97-role-time-cross-channel-combo",
    name: "Role + Time + Cross-Channel Combo",
    description:
      "Historical role + relative time + cross-channel. AI should handle all dimensions correctly.",
    category: "G3",
    priority: "P1",
    userProfile: {
      name: "User Q",
      email: "user.q@example.com",
    },
    messages: [
      {
        person: "User Q",
        content: "I'm the security lead for all production systems.",
        time: "2024-11-01T10:00:00Z",
        platform: "Slack",
        channel: "security",
      },
      {
        person: "Security Scanner",
        content:
          "Critical vulnerability detected in authentication module. Patch by end of week.",
        time: "2024-11-25T09:00:00Z",
        platform: "Slack",
        channel: "security",
      },
      {
        person: "CTO",
        content:
          "User Q, following up on the auth vulnerability. Need status update ASAP.",
        time: "2024-11-25T16:00:00Z",
        platform: "Email",
        channel: "security-team",
      },
    ],
    expected: {
      urgency: "immediate",
      importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-98-vip-overdue-escalation-combo",
    name: "VIP + Overdue + Escalation Combo",
    description:
      "VIP request + overdue + escalation. AI should prioritize extremely high.",
    category: "G1",
    priority: "P0",
    userProfile: {
      name: "User R",
      email: "user.r@example.com",
    },
    messages: [
      {
        person: "Enterprise Client | Fortune 100",
        content:
          "User R, we need the custom integration completed by yesterday for our board presentation.",
        time: "2024-11-26T08:00:00Z",
        platform: "Email",
        channel: "enterprise-support",
      },
      {
        person: "CEO",
        content:
          "User R - this client is critical. Drop everything and get this done NOW.",
        time: "2024-11-26T09:00:00Z",
        platform: "Slack DM",
        channel: "direct-message",
      },
    ],
    expected: {
      urgency: "immediate",
      importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-99-broadcast-role-dedup-combo",
    name: "Broadcast + Role Match + Deduplication Combo",
    description:
      "Broadcast alert + role match + multiple channels. AI should generate ONE urgent task.",
    category: "G2",
    priority: "P0",
    userProfile: {
      name: "User S",
      email: "user.s@example.com",
    },
    messages: [
      {
        person: "User S",
        content: "I'm the DevOps lead for infrastructure.",
        time: "2024-11-10T10:00:00Z",
        platform: "Slack",
        channel: "infrastructure",
      },
      {
        person: "Monitoring System",
        content:
          "🚨 CRITICAL: Database cluster is down. All services affected.",
        time: "2024-11-25T18:00:00Z",
        platform: "Slack",
        channel: "infrastructure",
      },
      {
        person: "Monitoring System",
        content: "Alert: Production database outage detected at 18:00 UTC.",
        time: "2024-11-25T18:01:00Z",
        platform: "Email",
        channel: "ops-alerts",
      },
      {
        person: "On-Call Manager",
        content: "User S - database is down, need immediate response!",
        time: "2024-11-25T18:05:00Z",
        platform: "Discord",
        channel: "incidents",
      },
    ],
    expected: {
      urgency: "immediate",
      importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-100-dm-group-context-switch",
    name: "DM-Group Context Switch (Should Track Correctly)",
    description:
      "Task starts in group, continues in DM, back to group. AI should track as one task.",
    category: "F1",
    priority: "P1",
    userProfile: {
      name: "User T",
      email: "user.t@example.com",
    },
    messages: [
      {
        person: "User U",
        content:
          "Team, we need someone to lead the Q1 planning. User T, interested?",
        time: "2024-11-25T10:00:00Z",
        platform: "Slack",
        channel: "leadership",
      },
      {
        person: "User T",
        content: "Yes, I can lead it. What's the timeline?",
        time: "2024-11-25T10:15:00Z",
        platform: "Slack",
        channel: "leadership",
      },
      {
        person: "User U",
        content: "Great! Let me DM you the details and stakeholder list.",
        time: "2024-11-25T10:20:00Z",
        platform: "Slack DM",
        channel: "direct-message",
      },
      {
        person: "User U",
        content:
          "Here's the stakeholder list and timeline. Need the plan by Dec 1st. Let's sync in the group channel once you have a draft.",
        time: "2024-11-25T10:25:00Z",
        platform: "Slack DM",
        channel: "direct-message",
      },
    ],
    expected: {
      urgency: "24h",
      importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  // ========== Category A2.1: Request-Response Attribution ==========
  {
    id: "issue-101-email-provider-misattribution",
    name: "Email Provider Misattribution (A asks, B provides, C observes)",
    description:
      "User A asks for email, User B provides their email. User C (me) is observing. AI should NOT attribute the action to User C.",
    category: "A2.1",
    priority: "P0",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
    },
    messages: [
      {
        person: "User E",
        content:
          "Can someone give me an email to contact the Coinbase Listing team?",
        time: "2024-11-25T00:28:00Z",
        platform: "Telegram",
        channel: "Project P <> Reforge",
      },
      {
        person: "User F",
        content: "Thank you so much, my email: contact@projectalpha.example",
        time: "2024-11-26T00:12:00Z",
        platform: "Telegram",
        channel: "Project P <> Reforge",
      },
    ],
    expected: {
      urgency: "not_urgent",
      myTasksCount: 0,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-102-document-share-misattribution",
    name: "Document Share Misattribution (A requests, B shares, C observes)",
    description:
      "User A requests document, User B shares link. User C (me) should NOT be credited for sharing.",
    category: "A2.1",
    priority: "P0",
    userProfile: {
      name: "User C",
      email: "user.c@example.com",
    },
    messages: [
      {
        person: "User A",
        content:
          "Does anyone have the Q3 financial report? Need it for the board meeting.",
        time: "2024-11-25T10:00:00Z",
        platform: "Slack",
        channel: "finance",
      },
      {
        person: "User B",
        content:
          "Here's the link: https://docs.company.com/q3-report. Let me know if you need anything else.",
        time: "2024-11-25T10:15:00Z",
        platform: "Slack",
        channel: "finance",
      },
    ],
    expected: {
      urgency: "not_urgent",
      myTasksCount: 0,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-103-delayed-response-attribution",
    name: "Delayed Response Attribution (Request and response separated by other messages)",
    description:
      "User A requests contact info. Multiple messages in between. User B responds. User C (me) should NOT be involved.",
    category: "A2.1",
    priority: "P1",
    userProfile: {
      name: "User C",
      email: "user.c@example.com",
    },
    messages: [
      {
        person: "User A",
        content: "Who can I contact about the partnership proposal?",
        time: "2024-11-25T14:00:00Z",
        platform: "Discord",
        channel: "partnerships",
      },
      {
        person: "User D",
        content: "I think the BD team handles that.",
        time: "2024-11-25T14:05:00Z",
        platform: "Discord",
        channel: "partnerships",
      },
      {
        person: "User E",
        content: "Yeah, reach out to them directly.",
        time: "2024-11-25T14:10:00Z",
        platform: "Discord",
        channel: "partnerships",
      },
      {
        person: "User B",
        content:
          "User A, you can contact me directly. My email is bd@company.com",
        time: "2024-11-25T14:20:00Z",
        platform: "Discord",
        channel: "partnerships",
      },
    ],
    expected: {
      urgency: "not_urgent",
      myTasksCount: 0,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-104-pronoun-resolution-my-contact",
    name: "Pronoun Resolution - 'My Contact' (Should identify speaker)",
    description:
      "User B says 'my phone is...'. AI should identify User B as the provider, not User C (me) who is observing.",
    category: "A2.1",
    priority: "P1",
    userProfile: {
      name: "User C",
      email: "user.c@example.com",
    },
    messages: [
      {
        person: "User A",
        content:
          "I need a phone number for urgent technical support. Anyone available?",
        time: "2024-11-25T16:00:00Z",
        platform: "Slack",
        channel: "support",
      },
      {
        person: "User B",
        content:
          "I can help. My phone is +1-555-0123. Call me anytime for urgent issues.",
        time: "2024-11-25T16:05:00Z",
        platform: "Slack",
        channel: "support",
      },
    ],
    expected: {
      urgency: "not_urgent",
      myTasksCount: 0,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-105-multiple-concurrent-requests",
    name: "Multiple Concurrent Requests (Correct pairing)",
    description:
      "Multiple people request different things. AI should correctly pair each request with its response, not attribute to User C (me).",
    category: "A2.1",
    priority: "P1",
    userProfile: {
      name: "User C",
      email: "user.c@example.com",
    },
    messages: [
      {
        person: "User A",
        content: "Can someone send me the API documentation?",
        time: "2024-11-25T11:00:00Z",
        platform: "Slack",
        channel: "engineering",
      },
      {
        person: "User D",
        content: "I need the deployment guide too.",
        time: "2024-11-25T11:02:00Z",
        platform: "Slack",
        channel: "engineering",
      },
      {
        person: "User B",
        content: "User A, here's the API docs: https://docs.api.com/reference",
        time: "2024-11-25T11:05:00Z",
        platform: "Slack",
        channel: "engineering",
      },
      {
        person: "User E",
        content:
          "User D, deployment guide is here: https://wiki.company.com/deploy",
        time: "2024-11-25T11:07:00Z",
        platform: "Slack",
        channel: "engineering",
      },
    ],
    expected: {
      urgency: "not_urgent",
      myTasksCount: 0,
      waitingForOthersCount: 0,
    },
  },
  // ========== Category E4: Semantic Deduplication ==========
  {
    id: "issue-106-multi-step-semantic-dedup",
    name: "Multi-Step Semantic Deduplication (Introduction → Meeting)",
    description:
      "User B confirms interest, User C introduces teams, User D shares Calendly. Should merge into ONE task, not create duplicate 'schedule meeting' tasks.",
    category: "E4",
    priority: "P0",
    userProfile: {
      name: "CiCi",
      email: "user.a@example.com",
    },
    messages: [
      {
        person: "User B",
        content:
          "Project C and Ryno looks like a good fits, love to talk to them! Thanks",
        time: "2024-11-25T21:44:00Z",
        platform: "Telegram",
        channel: "Project P x 0xLabs",
      },
      {
        person: "User C | TeamX",
        content:
          "Great! Let me introduce the Project C and Ryno teams to Project P team.",
        time: "2024-11-26T02:00:00Z",
        platform: "Telegram",
        channel: "Project P <> Project C",
      },
      {
        person: "User D | PartnerY",
        content:
          "Here is mine if it makes it easier! @CiCi https://calendly.com/user-d/30min",
        time: "2024-11-26T03:55:00Z",
        platform: "Telegram",
        channel: "Project P <> Project C",
      },
    ],
    expected: {
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-107-implicit-vs-explicit-task",
    name: "Implicit vs Explicit Task (Should Merge)",
    description:
      "Implicit 'introduce teams' and explicit 'schedule meeting' are the same goal. Should merge, not duplicate.",
    category: "E4",
    priority: "P1",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
    },
    messages: [
      {
        person: "User B",
        content:
          "User A, let me introduce you to the design team. They can help with your project.",
        time: "2024-11-25T10:00:00Z",
        platform: "Slack",
        channel: "introductions",
      },
      {
        person: "User C | Design Lead",
        content:
          "Hi User A! Here's my calendar link to schedule an intro call: https://cal.com/design-lead",
        time: "2024-11-25T14:00:00Z",
        platform: "Slack",
        channel: "introductions",
      },
    ],
    expected: {
      // urgency: "24h",
      importance: "medium",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-108-different-angles-same-task",
    name: "Different Angles Same Task (Introduction + Scheduling + Contact)",
    description:
      "Same task described from different angles: introduce, schedule, share contact. Should recognize as ONE task.",
    category: "E4",
    priority: "P1",
    userProfile: {
      name: "CiCi",
      email: "user.d@example.com",
    },
    messages: [
      {
        person: "User E",
        content: "CiCi, I'd like to introduce you to our partnership team.",
        time: "2024-11-25T09:00:00Z",
        platform: "Email",
        channel: "partnerships",
      },
      {
        person: "User F | Partnership Lead",
        content:
          "Great to connect! Let's schedule a call to discuss collaboration opportunities.",
        time: "2024-11-25T11:00:00Z",
        platform: "Email",
        channel: "partnerships",
      },
      {
        person: "User F | Partnership Lead",
        content:
          "Here's my contact: partnerships@company.com. Looking forward to our chat!",
        time: "2024-11-25T11:05:00Z",
        platform: "Email",
        channel: "partnerships",
      },
    ],
    expected: {
      // urgency: "24h",
      importance: "medium",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  // ========== Category M: Waiting Status Management ==========
  {
    id: "issue-109-waiting-condition-satisfied",
    name: "Waiting Condition Satisfied (Should Close Waiting)",
    description:
      "Waiting for A to confirm. A confirms. Waiting should close, not persist.",
    category: "M1",
    priority: "P0",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
    },
    messages: [
      {
        person: "User A",
        content:
          "Can you confirm if Project C and Ryno are good fits for our project?",
        time: "2024-11-24T10:00:00Z",
        platform: "Telegram",
        channel: "Project P x 0xLabs",
      },
      {
        person: "User B",
        content:
          "Project C and Ryno looks like a good fits, love to talk to them! Thanks",
        time: "2024-11-25T21:44:00Z",
        platform: "Telegram",
        channel: "Project P x 0xLabs",
      },
      {
        person: "User C | TeamX",
        content:
          "Confirmed! I've already introduced both teams. Haley from Project C shared her calendar link.",
        time: "2024-11-26T02:00:00Z",
        platform: "Telegram",
        channel: "Project P x 0xLabs",
      },
    ],
    expected: {
      urgency: "not_urgent",
      myTasksCount: 0,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-110-multi-party-confirmation-chain",
    name: "Multi-Party Confirmation Chain (Waiting Should Update)",
    description:
      "A requests → B confirms → C executes. Waiting status should update with progress, not stay 'waiting for B' after C completes.",
    category: "M1",
    priority: "P0",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
    },
    messages: [
      {
        person: "User A",
        content:
          "Can someone help introduce our team to the enterprise clients?",
        time: "2024-11-24T09:00:00Z",
        platform: "Slack",
        channel: "sales",
      },
      {
        person: "User B | Sales Lead",
        content:
          "Yes, I can help with that. Let me coordinate with the account team.",
        time: "2024-11-24T14:00:00Z",
        platform: "Slack",
        channel: "sales",
      },
      {
        person: "User C | Account Manager",
        content:
          "Done! I've sent intro emails to all three enterprise clients. They're expecting your follow-up.",
        time: "2024-11-25T10:00:00Z",
        platform: "Slack",
        channel: "sales",
      },
    ],
    expected: {
      urgency: "24h",
      importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  // ========== Category N: Task Classification Exclusivity ==========
  {
    id: "issue-111-calendly-shared-to-me",
    name: "Calendly Shared TO Me (Should be Owned, NOT Waiting)",
    description: "Partner shares Calendly link to me. Should not my tasks.",
    category: "N1",
    priority: "P0",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
    },
    messages: [
      {
        person: "User G",
        content:
          "Hi Team, thanks for filling out the mainnet readiness form. Let's hop on a call to understand your needs. https://calendly.com/user-g/30min",
        time: "2024-11-24T20:35:00Z",
        platform: "Telegram",
        channel: "Project A <> Project P",
      },
    ],
    expected: {
      // urgency: "24h",
      importance: "medium",
      myTasksCount: 0,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-112-calendly-shared-by-me",
    name: "Calendly Shared BY Me (Should be Waiting, NOT Owned)",
    description:
      "I share Calendly link to partner. Waiting for them to schedule. Should be 'Waiting on others', NOT 'Owned by you'.",
    category: "N1",
    priority: "P0",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
    },
    messages: [
      {
        person: "User A",
        content:
          "Here's my calendar link for our intro call: https://calendly.com/user-a/30min. Please pick a time that works for you!",
        time: "2024-11-25T10:00:00Z",
        platform: "Email",
        channel: "partnerships",
      },
    ],
    expected: {
      urgency: "not_urgent",
      myTasksCount: 0,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-113-owned-waiting-others",
    name: "Owned by Me + Waiting on Others (Valid, Should be Owned)",
    description:
      "I'm responsible but waiting for others' input. Should be 'Owned by you' (primary), may track waiting separately.",
    category: "N1",
    priority: "P1",
    userProfile: {
      name: "User B",
      email: "user.b@example.com",
    },
    messages: [
      {
        person: "User C",
        content:
          "User B, can you prepare the quarterly report? I'll send you the sales data by tomorrow.",
        time: "2024-11-25T09:00:00Z",
        platform: "Slack",
        channel: "finance",
      },
    ],
    expected: {
      urgency: "24h",
      // importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 1,
    },
  },
  {
    id: "issue-114-contradictory-state",
    name: "Contradictory State (Owner: me + Waiting on: me → Should Fix)",
    description:
      "Task shows Owner: me AND Waiting on: me. This is contradictory. Should resolve to 'Owned by you' only.",
    category: "N1",
    priority: "P0",
    userProfile: {
      name: "User D",
      email: "user.d@example.com",
    },
    messages: [
      {
        person: "User E",
        content:
          "User D, please review and approve the design mockups when you get a chance today.",
        time: "2024-11-25T14:00:00Z",
        platform: "Slack",
        channel: "design",
      },
    ],
    expected: {
      urgency: "24h",
      importance: "medium",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-115-task-state-transition",
    name: "Task State Transition (Waiting → Owned, No Overlap)",
    description:
      "Initially waiting for confirmation. After confirmation, should transition to Owned. Should NOT appear in both lists simultaneously.",
    category: "N1",
    priority: "P1",
    userProfile: {
      name: "User F",
      email: "user.f@example.com",
    },
    messages: [
      {
        person: "User F",
        content: "Can someone confirm if we should proceed with the migration?",
        time: "2024-11-24T10:00:00Z",
        platform: "Slack",
        channel: "engineering",
      },
      {
        person: "User G | CTO",
        content:
          "Yes, confirmed. User F, please proceed with the database migration. Let me know if you need resources.",
        time: "2024-11-25T09:00:00Z",
        platform: "Slack",
        channel: "engineering",
      },
    ],
    expected: {
      // urgency: "24h",
      importance: "high",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  // ========== Category O: Knowledge & Memory ==========
  {
    id: "issue-116-knowledge-synthesis",
    name: "Knowledge Synthesis (Draft Report)",
    description:
      "User asks to synthesize progress from last week into a report. AI should identify this as a task.",
    category: "O1",
    priority: "P1",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
    },
    messages: [
      {
        person: "User B",
        content:
          "User A, could you please summarize the project progress from last week and draft a brief report for the stakeholders?",
        time: "2024-11-26T09:00:00Z",
        platform: "Slack",
        channel: "project-alpha",
      },
    ],
    expected: {
      // urgency: "24h",
      // importance: "medium",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-117-memory-recall",
    name: "Memory Recall (Retrieve Conclusion)",
    description:
      "User asks about a past decision. AI should identify this as a task to answer/retrieve the info.",
    category: "O2",
    priority: "P1",
    userProfile: {
      name: "User C",
      email: "user.c@example.com",
    },
    messages: [
      {
        person: "User D",
        content:
          "User C, do you remember what we decided regarding the database migration strategy in the last meeting?",
        time: "2024-11-26T10:00:00Z",
        platform: "Slack",
        channel: "engineering",
      },
    ],
    expected: {
      // urgency: "not_urgent", // Information request, usually not "immediate" unless specified
      importance: "medium",
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  // ========== Category G: Priority Assessment (Update) ==========
  {
    id: "issue-118-sales-response",
    name: "Sales Rapid Response (Client Inquiry)",
    description:
      "Client asks a question requiring a quick response. AI should mark as Urgent/High Priority.",
    category: "G4",
    priority: "P1",
    userProfile: {
      name: "User E",
      email: "user.e@example.com",
      role: "Sales Lead",
    },
    messages: [
      {
        person: "Client X",
        content:
          "Hi User E, we need to finalize the contract terms. Can you get back to us with the revised pricing by 2 PM today?",
        time: "2024-11-26T10:00:00Z", // Assuming current time is before 2 PM
        platform: "Email",
        channel: "external-client",
      },
    ],
    expected: {
      urgency: "immediate", // "by 2 PM today" implies immediate/same-day action
      importance: "high", // Client request
      myTasksCount: 1,
      waitingForOthersCount: 0,
    },
  },
  {
    id: "issue-119-meeting-followup-stakeholder",
    name: "Meeting Follow-up (Stakeholder Interest)",
    description:
      "User introduces A and B. A assigns a task to B. Since User initiated the connection, this outcome is highly important to User even if not assigned to them.",
    category: "G5",
    priority: "P1",
    userProfile: {
      name: "User F",
      email: "user.f@example.com",
      role: "Partnership Lead",
    },
    messages: [
      {
        person: "User F",
        content:
          "Hi User G, great to meet you as well. Would you mind sharing your Calendly link so we can book a time to discuss the Project Alpha and ways we can collaborate?",
        time: "2024-11-26T23:28:00Z",
        platform: "Telegram",
        channel: "Project Alpha Discussion Group",
      },
      {
        person: "User G",
        content:
          "Confirmed internally that @UserI is an external community volunteer. User H, please follow up on the Project Alpha review process via the #project-alpha-editing Discord channel.",
        time: "2024-11-27T06:30:00Z",
        platform: "Telegram",
        channel: "Project Alpha Discussion Group",
      },
      {
        person: "User H",
        content: "Thanks User G, will do.",
        time: "2024-11-27T17:46:00Z",
        platform: "Telegram",
        channel: "Project Alpha Discussion Group",
      },
    ],
    expected: {
      // urgency: "not_urgent", // Not urgent for User F (me)
      // importance: "high", // High importance because User F initiated the connection
      myTasksCount: 1,
      waitingForOthersCount: 1, // Should track User H's action as it's the outcome of my intro
    },
  },
  {
    id: "issue-120-revenue-opportunity",
    name: "Revenue Opportunity (Competitor Mention)",
    description:
      "User A (Sales) sees a message in a general group about a problem that their product solves. Should be identified as a lead.",
    category: "P1",
    priority: "P1",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
      role: "Sales Representative",
    },
    messages: [
      {
        person: "User B",
        content:
          "We are struggling with high latency in our current data pipeline (Provider X). It's costing us deals.",
        time: "2024-11-28T10:00:00Z",
        platform: "Discord",
        channel: "Data Engineering",
      },
    ],
    expected: {
      urgency: "not_urgent",
      importance: "high", // Revenue opportunity
      insightCount: 1, // Should generate an insight/lead
      tags: ["Revenue Lead"],
    },
  },
  {
    id: "issue-121-opportunity-rescue",
    name: "Opportunity Rescue (Missed VC Message)",
    description:
      "User B (Founder) missed a message from a VC 2 weeks ago. openloomi should surface this as a rescued opportunity.",
    category: "P4",
    priority: "P0",
    userProfile: {
      name: "User B",
      email: "user.b@example.com",
      role: "Founder",
    },
    messages: [
      {
        person: "VC Partner",
        content:
          "Hi User B, saw your pitch deck. We'd love to chat about leading your seed round. Let me know if you're free next week.",
        time: "2024-11-14T10:00:00Z", // 2 weeks ago
        platform: "LinkedIn",
        channel: "DM",
      },
    ],
    expected: {
      // urgency: "immediate", // High urgency because it's old and critical
      importance: "high",
      myTasksCount: 1, // Should be a task to reply
      tags: ["Opportunity Rescue"],
    },
  },
  {
    id: "issue-122-context-switch-reduction",
    name: "Context Switch Reduction (Cross-Platform Reply)",
    description:
      "User C receives a Slack message while on WeChat. openloomi should suggest drafting a reply without switching apps.",
    category: "Q1",
    priority: "P2",
    userProfile: {
      name: "User C",
      email: "user.c@example.com",
    },
    messages: [
      {
        person: "User D",
        content: "Quick question: what's the status of the Q3 report?",
        time: "2024-11-28T11:00:00Z",
        platform: "Slack",
        channel: "general",
      },
    ],
    expected: {
      urgency: "not_urgent",
      importance: "medium",
      myTasksCount: 0,
    },
  },
  {
    id: "issue-123-connector-network-effect",
    name: "The Connector (Supply/Demand Matching)",
    description:
      "User A asks for X in Group 1. User B offers X in Group 2. openloomi should suggest connecting them.",
    category: "P5",
    priority: "P1",
    userProfile: {
      name: "User Me",
      email: "user.me@example.com",
      role: "Community Manager",
    },
    messages: [
      {
        person: "User A",
        content: "Does anyone know a good auditor for ZK circuits?",
        time: "2024-11-29T10:00:00Z",
        platform: "Telegram",
        channel: "Dev Group",
      },
      {
        person: "User B",
        content: "We just launched our ZK audit service. DM for details.",
        time: "2024-11-29T10:05:00Z",
        platform: "Discord",
        channel: "Service Providers",
      },
    ],
    expected: {
      urgency: "not_urgent",
      // importance: "high", // High value connection
      insightCount: 1, // Should generate a "Connect A and B" insight
      tags: ["Network Connection"],
    },
  },
  {
    id: "issue-124-high-effort-extraction",
    name: "High-Effort Extraction (Meeting Transcript)",
    description:
      "User receives a long meeting transcript. openloomi should extract action items and summary.",
    category: "Q3",
    priority: "P2",
    userProfile: {
      name: "User Me",
      email: "user.me@example.com",
    },
    messages: [
      {
        person: "Meeting Bot",
        content:
          "Transcript: ... User A: I'll handle the frontend migration by Friday. User B: I'll check the API logs. User C: Let's sync next Monday. ...",
        time: "2024-11-29T14:00:00Z",
        platform: "Slack",
        channel: "Meeting Notes",
      },
    ],
    expected: {
      urgency: "not_urgent",
      importance: "medium",
      myTasksCount: 0, // No tasks for Me, but should extract info
      insightCount: 1, // Summary/Extraction insight
    },
  },
  {
    id: "issue-125-smart-actions",
    name: "Smart Actions (Contextual Reply)",
    description:
      "User A asks 'Can we meet?'. openloomi should suggest 'Send Calendly' or 'Propose Slots'.",
    category: "Q4",
    priority: "P2",
    userProfile: {
      name: "User Me",
      email: "user.me@example.com",
    },
    messages: [
      {
        person: "User A",
        content: "Hey, are you free to chat about the partnership next week?",
        time: "2024-11-29T15:00:00Z",
        platform: "WhatsApp",
        channel: "DM",
      },
    ],
    expected: {
      // urgency: "not_urgent",
      importance: "medium",
      myTasksCount: 1, // Task to reply
      // Ideally we'd check for specific action suggestions, but for now we check task generation
    },
  },
  {
    id: "issue-126-partnership-leads",
    name: "Partnership Leads (Collaboration Signal)",
    description:
      "User sees a message about a potential synergy. openloomi should identify it as a partnership lead.",
    category: "P2",
    priority: "P1",
    userProfile: {
      name: "User Me",
      email: "user.me@example.com",
      role: "Partnership Lead",
    },
    messages: [
      {
        person: "User External",
        content:
          "We are looking for an oracle provider for our new DeFi protocol. We have $500M TVL.",
        time: "2024-11-30T10:00:00Z",
        platform: "Telegram",
        channel: "DeFi Builders",
      },
    ],
    expected: {
      urgency: "24h",
      importance: "high", // Partnership opportunity
      insightCount: 1,
      tags: ["Partnership Opportunity"],
    },
  },
  {
    id: "issue-127-investor-updates",
    name: "Investor Updates (Market Signal)",
    description:
      "User sees a message relevant to investors (e.g., competitor funding, market shift).",
    category: "P3",
    priority: "P1",
    userProfile: {
      name: "User Me",
      email: "user.me@example.com",
      role: "Founder",
    },
    messages: [
      {
        person: "News Bot",
        content:
          "Competitor X just raised $50M Series B led by Paradigm. They are expanding to Asia.",
        time: "2024-11-30T11:00:00Z",
        platform: "Twitter",
        channel: "Feed",
      },
    ],
    expected: {
      urgency: "not_urgent",
      importance: "high", // Critical market info
      insightCount: 1,
      tags: ["Market Intelligence"],
    },
  },
  {
    id: "issue-128-routine-automation",
    name: "Routine Automation (Weekly Report)",
    description:
      "User sends the same 'Weekly Report' every Friday. openloomi should suggest automating it.",
    category: "Q2",
    priority: "P2",
    userProfile: {
      name: "User Me",
      email: "user.me@example.com",
    },
    messages: [
      {
        person: "User Me",
        content: "Here is the weekly engineering report: [Link]",
        time: "2024-11-29T17:00:00Z", // Friday
        platform: "Slack",
        channel: "Engineering",
      },
    ],
    expected: {
      urgency: "not_urgent",
      // importance: "low",
      myTasksCount: 0,
      // Ideally check for automation suggestion, but for now check it doesn't create a task
    },
  },
  // P1 Variations
  {
    id: "issue-129-revenue-indirect",
    name: "Revenue Opportunity (Indirect Problem)",
    description: "User mentions a wish for a tool like ours.",
    category: "P1",
    priority: "P2",
    userProfile: { name: "User A", email: "a@example.com", role: "Sales" },
    messages: [
      {
        person: "User B",
        content: "I wish there was a way to auto-sync these logs.",
        time: "2024-11-30T10:00:00Z",
        platform: "Discord",
        channel: "General",
      },
    ],
    expected: {
      urgency: "not_urgent",
      // importance: "high",
      insightCount: 1,
      tags: ["Revenue Lead"],
    },
  },
  {
    id: "issue-130-revenue-budget",
    name: "Revenue Opportunity (Budget Approval)",
    description: "User mentions getting budget for a relevant tool.",
    category: "P1",
    priority: "P1",
    userProfile: { name: "User A", email: "a@example.com", role: "Sales" },
    messages: [
      {
        person: "User C",
        content:
          "Good news, we finally got budget approved for the monitoring stack.",
        time: "2024-11-30T10:05:00Z",
        platform: "Telegram",
        channel: "General",
      },
    ],
    expected: {
      urgency: "not_urgent",
      // importance: "high",
      insightCount: 1,
      tags: ["Revenue Lead"],
    },
  },
  // P2 Variations
  {
    id: "issue-131-partnership-comarketing",
    name: "Partnership (Co-marketing)",
    description: "User looking for speakers/partners for an event.",
    category: "P2",
    priority: "P2",
    userProfile: {
      name: "User Me",
      email: "me@example.com",
      role: "Marketing",
    },
    messages: [
      {
        person: "User D",
        content: "We are hosting a ZK summit in Denver. Looking for partners.",
        time: "2024-11-30T10:10:00Z",
        platform: "Twitter",
        channel: "Feed",
      },
    ],
    expected: {
      urgency: "not_urgent",
      // importance: "high",
      insightCount: 1,
      tags: ["Partnership Opportunity"],
    },
  },
  {
    id: "issue-132-partnership-integration",
    name: "Partnership (Integration Request)",
    description: "User asking about support for a protocol we could integrate.",
    category: "P2",
    priority: "P2",
    userProfile: { name: "User Me", email: "me@example.com", role: "Product" },
    messages: [
      {
        person: "User E",
        content: "Does anyone support the new EIP-4844 blob transactions yet?",
        time: "2024-11-30T10:15:00Z",
        platform: "Discord",
        channel: "Devs",
      },
    ],
    expected: {
      urgency: "not_urgent",
      // importance: "high",
      insightCount: 1,
      tags: ["Partnership Opportunity"],
    },
  },
  // P3 Variations
  {
    id: "issue-133-investor-regulatory",
    name: "Investor Update (Regulatory)",
    description: "News about regulatory changes affecting the market.",
    category: "P3",
    priority: "P1",
    userProfile: { name: "User Me", email: "me@example.com", role: "Founder" },
    messages: [
      {
        person: "News Bot",
        content: "BREAKING: SEC approves Spot ETH ETF.",
        time: "2024-11-30T10:20:00Z",
        platform: "Twitter",
        channel: "Feed",
      },
    ],
    expected: {
      urgency: "not_urgent",
      // importance: "high",
      insightCount: 1,
      tags: ["Market Intelligence"],
    },
  },
  // P4 Variations
  {
    id: "issue-134-rescue-followup",
    name: "Opportunity Rescue (Forgotten Follow-up)",
    description: "User missed a follow-up question from a lead.",
    category: "P4",
    priority: "P1",
    userProfile: { name: "User Me", email: "me@example.com", role: "Sales" },
    messages: [
      {
        person: "Lead X",
        content: "Did you get a chance to look at the contract redlines?",
        time: "2024-11-15T10:00:00Z",
        platform: "Email",
        channel: "Inbox",
      },
    ],
    expected: {
      // urgency: "immediate",
      // importance: "high",
      myTasksCount: 1,
      tags: ["Opportunity Rescue"],
    },
  },
  // P5 Variations
  {
    id: "issue-135-connector-expertise",
    name: "The Connector (Expertise Matching)",
    description:
      "Matching someone looking for a skill with someone who has it.",
    category: "P5",
    priority: "P2",
    userProfile: {
      name: "User Me",
      email: "me@example.com",
      role: "Community",
    },
    messages: [
      {
        person: "User F",
        content: "Who knows Rust here?",
        time: "2024-11-30T10:30:00Z",
        platform: "Telegram",
        channel: "Devs",
      },
      {
        person: "User G",
        content: "I've been writing Rust for 5 years.",
        time: "2024-11-30T10:35:00Z",
        platform: "Discord",
        channel: "General",
      },
    ],
    expected: {
      urgency: "not_urgent",
      // importance: "high",
      insightCount: 1,
      tags: ["Network Connection"],
    },
  },
  // Q1 Variations
  {
    id: "issue-136-context-copypaste",
    name: "Context Switch (Copy-Paste)",
    description: "User asks to copy info to another tool.",
    category: "Q1",
    priority: "P2",
    userProfile: { name: "User Me", email: "me@example.com" },
    messages: [
      {
        person: "User H",
        content:
          "Can you create a Jira ticket for this bug: 'Login failed on Safari'?",
        time: "2024-11-30T10:40:00Z",
        platform: "Slack",
        channel: "Devs",
      },
    ],
    expected: { urgency: "not_urgent", importance: "medium", myTasksCount: 1 },
  },
  {
    id: "issue-137-context-link",
    name: "Context Switch (Link Opening)",
    description: "User shares a link that should be opened in a specific app.",
    category: "Q1",
    priority: "P2",
    userProfile: { name: "CiCi", email: "me@example.com" },
    messages: [
      {
        person: "User I",
        content: "Check this Notion doc for the specs: [Link]",
        time: "2024-11-30T10:45:00Z",
        platform: "Slack",
        channel: "General",
      },
    ],
    expected: {
      urgency: "not_urgent",
      // importance: "low",
      myTasksCount: 0,
    },
  },
  // Q2 Variations
  {
    id: "issue-138-routine-standup",
    name: "Routine (Daily Standup)",
    description: "User posts daily standup.",
    category: "Q2",
    priority: "P2",
    userProfile: { name: "User Me", email: "me@example.com" },
    messages: [
      {
        person: "User Me",
        content: "Yesterday: Fixed bug X. Today: Working on feature Y.",
        time: "2024-11-30T09:00:00Z",
        platform: "Slack",
        channel: "Standup",
      },
    ],
    expected: { urgency: "not_urgent", importance: "medium", myTasksCount: 0 },
  },
  // Q3 Variations
  {
    id: "issue-139-extraction-summary",
    name: "Extraction (Chat Summary)",
    description: "User asks to summarize a long debate.",
    category: "Q3",
    priority: "P2",
    userProfile: { name: "User Me", email: "me@example.com" },
    messages: [
      {
        person: "User Me",
        content: "Can you summarize the debate above about the API design?",
        time: "2024-11-30T11:00:00Z",
        platform: "Slack",
        channel: "Devs",
      },
    ],
    expected: { urgency: "not_urgent", importance: "medium", insightCount: 1 },
  },
  // Q4 Variations
  {
    id: "issue-140-smart-action-ticket",
    name: "Smart Action (Create Ticket)",
    description: "openloomi suggests creating a ticket from a bug report.",
    category: "Q4",
    priority: "P2",
    userProfile: { name: "User Me", email: "me@example.com" },
    messages: [
      {
        person: "User J",
        content:
          "Found a critical bug in production: Payment gateway 500s. Could you pls check it?",
        time: "2024-11-30T11:10:00Z",
        platform: "Slack",
        channel: "DM",
      },
    ],
    expected: { urgency: "immediate", importance: "high", myTasksCount: 1 },
  },
  {
    id: "issue-141-smart-action-email",
    name: "Smart Action (Draft Email)",
    description: "openloomi suggests drafting an intro email.",
    category: "Q4",
    priority: "P2",
    userProfile: { name: "User Me", email: "me@example.com" },
    messages: [
      {
        person: "User K",
        content: "Can you intro me to User L via email?",
        time: "2024-11-30T11:15:00Z",
        platform: "WhatsApp",
        channel: "DM",
      },
    ],
    expected: {
      // urgency: "not_urgent",
      importance: "medium",
      myTasksCount: 1,
    },
  },
  // Time-based P category variations
  {
    id: "issue-142-revenue-old-lead",
    name: "Revenue Opportunity (Old Lead Resurface)",
    description: "A lead from last month resurfaces with renewed interest.",
    category: "P1",
    priority: "P1",
    userProfile: { name: "User A", email: "a@example.com", role: "Sales" },
    messages: [
      {
        person: "Lead from Oct",
        content:
          "Hi, we discussed your solution last month. Our budget just got approved. Can we schedule a demo?",
        time: "2024-11-27T10:00:00Z",
        platform: "Email",
        channel: "Inbox",
      },
    ],
    expected: {
      urgency: "24h",
      importance: "high",
      myTasksCount: 1,
      tags: ["Revenue Lead"],
    },
  },
  {
    id: "issue-143-partnership-delayed",
    name: "Partnership (Delayed Response)",
    description: "A partnership inquiry from 3 weeks ago that needs follow-up.",
    category: "P2",
    priority: "P1",
    userProfile: {
      name: "User Me",
      email: "me@example.com",
      role: "Partnerships",
    },
    messages: [
      {
        person: "Partner Co",
        content:
          "Following up on our integration discussion from early November. Are you still interested?",
        time: "2024-11-27T11:00:00Z",
        platform: "LinkedIn",
        channel: "DM",
      },
    ],
    expected: {
      // urgency: "24h",
      // importance: "high",
      myTasksCount: 1,
      tags: ["Partnership Opportunity"],
    },
  },
  {
    id: "issue-144-investor-old-news",
    name: "Investor Update (Historical Trend)",
    description: "Market trend from last quarter that's now relevant.",
    category: "P3",
    priority: "P2",
    userProfile: { name: "User Me", email: "me@example.com", role: "Founder" },
    messages: [
      {
        person: "Analyst",
        content:
          "Remember the AI regulation trend we discussed in Q3? It's now official policy.",
        time: "2024-11-27T12:00:00Z",
        platform: "Email",
        channel: "Inbox",
      },
    ],
    expected: {
      urgency: "not_urgent",
      // importance: "high",
      insightCount: 1,
      tags: ["Market Intelligence"],
    },
  },
  {
    id: "issue-145-connector-old-request",
    name: "The Connector (Old Unmatched Request)",
    description: "Someone asked for help 2 weeks ago, now we see a match.",
    category: "P5",
    priority: "P2",
    userProfile: {
      name: "User Me",
      email: "me@example.com",
      role: "Community",
    },
    messages: [
      {
        person: "User X",
        content: "Looking for a Solidity auditor, anyone?",
        time: "2024-11-13T10:00:00Z",
        platform: "Telegram",
        channel: "Dev Group",
      },
      {
        person: "User Y",
        content: "I do smart contract audits. Happy to help.",
        time: "2024-11-27T10:00:00Z",
        platform: "Discord",
        channel: "Services",
      },
    ],
    expected: {
      urgency: "not_urgent",
      // importance: "high",
      insightCount: 1,
      tags: ["Network Connection"],
    },
  },
  // Time+People+Context Q category variations (Executive/Team scenarios)
  {
    id: "issue-146-q1-recurring-1on1",
    name: "Context Switch (Recurring 1:1 Prep)",
    description:
      "Executive has weekly 1:1s with 5 direct reports. openloomi should aggregate prep materials.",
    category: "Q1",
    priority: "P1",
    userProfile: {
      name: "User Me",
      email: "me@example.com",
      role: "VP Engineering",
    },
    messages: [
      {
        person: "Direct Report A",
        content: "Can we discuss the Q4 roadmap in our 1:1?",
        time: "2024-11-25T10:00:00Z",
        platform: "Slack",
        channel: "DM",
      },
      {
        person: "Direct Report B",
        content: "I have some concerns about the new process.",
        time: "2024-11-25T11:00:00Z",
        platform: "Slack",
        channel: "DM",
      },
      {
        person: "Direct Report C",
        content: "Quick sync on the hiring plan?",
        time: "2024-11-25T12:00:00Z",
        platform: "Slack",
        channel: "DM",
      },
    ],
    expected: { myTasksCount: 3 }, // Should suggest "Prepare 1:1 agenda"
  },
  {
    id: "issue-147-q2-weekly-team-sync",
    name: "Routine (Weekly Team Sync)",
    description:
      "Team lead runs weekly sync every Monday. openloomi should auto-generate agenda from last week's threads.",
    category: "Q2",
    priority: "P1",
    userProfile: {
      name: "User Me",
      email: "me@example.com",
      role: "Team Lead",
    },
    messages: [
      {
        person: "User Me",
        content:
          "Weekly sync agenda: 1) Sprint review 2) Blockers 3) Next week planning",
        time: "2024-11-18T09:00:00Z",
        platform: "Slack",
        channel: "Team",
      },
      {
        person: "User Me",
        content:
          "Weekly sync agenda: 1) Sprint review 2) Blockers 3) Next week planning",
        time: "2024-11-25T09:00:00Z",
        platform: "Slack",
        channel: "Team",
      },
    ],
    expected: { myTasksCount: 0 }, // Should suggest automation
  },
  {
    id: "issue-148-q3-monthly-report",
    name: "Extraction (Monthly Team Report)",
    description:
      "Executive needs to compile monthly report from scattered team updates.",
    category: "Q3",
    priority: "P1",
    userProfile: { name: "User Me", email: "me@example.com", role: "Director" },
    messages: [
      {
        person: "Team A Lead",
        content: "Team A shipped 3 features this month.",
        time: "2024-11-26T10:00:00Z",
        platform: "Slack",
        channel: "Updates",
      },
      {
        person: "Team B Lead",
        content: "Team B reduced latency by 40%.",
        time: "2024-11-26T11:00:00Z",
        platform: "Slack",
        channel: "Updates",
      },
      {
        person: "Team C Lead",
        content: "Team C onboarded 2 new engineers.",
        time: "2024-11-26T12:00:00Z",
        platform: "Slack",
        channel: "Updates",
      },
    ],
    expected: { urgency: "not_urgent", insightCount: 1 }, // Should extract and summarize
  },
  {
    id: "issue-149-q4-quarterly-okr",
    name: "Smart Action (Quarterly OKR Review)",
    description:
      "It's end of quarter. openloomi should suggest scheduling OKR review with team.",
    category: "Q4",
    priority: "P1",
    userProfile: {
      name: "User Me",
      email: "me@example.com",
      role: "VP Product",
    },
    messages: [
      {
        person: "CEO",
        content: "All VPs please submit Q4 OKR reviews by Dec 5.",
        time: "2024-11-27T10:00:00Z",
        platform: "Email",
        channel: "Inbox",
      },
    ],
    expected: { urgency: "24h", importance: "high", myTasksCount: 1 }, // Should suggest "Schedule team OKR review"
  },
  {
    id: "issue-150-q1-cross-team-coord",
    name: "Context Switch (Cross-Team Coordination)",
    description:
      "Executive coordinates between 3 teams on a shared project. openloomi should consolidate updates.",
    category: "Q1",
    priority: "P2",
    userProfile: { name: "User Me", email: "me@example.com", role: "CTO" },
    messages: [
      {
        person: "Frontend Lead",
        content: "UI is 80% done.",
        time: "2024-11-27T09:00:00Z",
        platform: "Slack",
        channel: "Project X",
      },
      {
        person: "Backend Lead",
        content: "API is ready for testing.",
        time: "2024-11-27T09:30:00Z",
        platform: "Slack",
        channel: "Project X",
      },
      {
        person: "QA Lead",
        content: "Test plan drafted.",
        time: "2024-11-27T10:00:00Z",
        platform: "Slack",
        channel: "Project X",
      },
    ],
    expected: { urgency: "not_urgent", insightCount: 1 }, // Should consolidate status
  },
  {
    id: "issue-151-q2-skip-level",
    name: "Routine (Skip-Level 1:1s)",
    description:
      "Senior exec does monthly skip-level 1:1s. openloomi should track and remind.",
    category: "Q2",
    priority: "P2",
    userProfile: { name: "User Me", email: "me@example.com", role: "SVP" },
    messages: [
      {
        person: "Calendar Bot",
        content: "Skip-level 1:1 with Engineer A scheduled for Nov 28.",
        time: "2024-11-27T08:00:00Z",
        platform: "Slack",
        channel: "Calendar",
      },
    ],
    expected: {
      // urgency: "not_urgent",
      importance: "medium",
      myTasksCount: 0,
    },
  },
  // R1: Event-Driven Role Priority
  {
    id: "issue-152-r1-fundraising-progress",
    name: "Event-Driven: Fundraising Progress",
    description:
      "Founder in fundraising mode receives VC message about internal discussion result.",
    category: "R1",
    priority: "P0",
    userProfile: {
      name: "User Me",
      email: "me@example.com",
      role: "Founder",
    },
    messages: [
      {
        person: "VC Partner",
        content:
          "Great news! Our partnership meeting approved moving forward with the term sheet. Can we schedule a call this week?",
        time: "2024-11-27T14:00:00Z",
        platform: "Email",
        channel: "Inbox",
      },
    ],
    expected: {
      // urgency: "immediate",
      importance: "high",
      myTasksCount: 1,
      tags: ["Fundraising Progress"],
    },
  },
  {
    id: "issue-153-r1-critical-hiring",
    name: "Event-Driven: Critical Hiring",
    description: "Hiring for CTO position, candidate accepts offer.",
    category: "R1",
    priority: "P0",
    userProfile: {
      name: "User Me",
      email: "me@example.com",
      role: "CEO",
    },
    messages: [
      {
        person: "CTO Candidate",
        content:
          "I'm excited to accept the CTO offer! When can we start the onboarding process?",
        time: "2024-11-27T15:00:00Z",
        platform: "Email",
        channel: "Inbox",
      },
    ],
    expected: {
      // urgency: "immediate",
      importance: "high",
      myTasksCount: 1,
      tags: ["Hiring Progress"],
    },
  },
  {
    id: "issue-154-r1-launch-partnership",
    name: "Event-Driven: Launch Partnership",
    description:
      "Product launch in 2 days, launch partner confirms participation.",
    category: "R1",
    priority: "P1",
    userProfile: {
      name: "User Me",
      email: "me@example.com",
      role: "Product Lead",
    },
    messages: [
      {
        person: "Launch Partner",
        content:
          "Confirmed! We'll feature your launch in our newsletter going out Monday. Need any assets?",
        time: "2024-11-27T16:00:00Z",
        platform: "Slack",
        channel: "Partnerships",
      },
    ],
    expected: {
      urgency: "24h",
      importance: "high",
      myTasksCount: 1,
      tags: ["Product Launch"],
    },
  },
  {
    id: "issue-155-r1-crisis-response",
    name: "Event-Driven: Crisis Response",
    description:
      "Negative news appeared, PR team provides crisis response advice.",
    category: "R1",
    priority: "P0",
    userProfile: {
      name: "User Me",
      email: "me@example.com",
      role: "CEO",
    },
    messages: [
      {
        person: "PR Lead",
        content:
          "URGENT: TechCrunch article just dropped. We need to issue a statement within 2 hours. Draft attached.",
        time: "2024-11-27T17:00:00Z",
        platform: "Slack",
        channel: "Crisis",
      },
    ],
    expected: {
      urgency: "immediate",
      importance: "high",
      myTasksCount: 1,
      tags: ["Crisis Response"],
    },
  },
  // R2: Stable Relationship Management
  {
    id: "issue-156-r2-cofounder-strategy",
    name: "Stable Relationship: Co-founder Strategy",
    description:
      "Co-founder discusses company direction and strategic decisions.",
    category: "R2",
    priority: "P1",
    userProfile: {
      name: "User Me",
      email: "me@example.com",
      role: "CEO",
    },
    messages: [
      {
        person: "Co-founder",
        content:
          "Been thinking about our 2025 strategy. Should we prioritize enterprise or keep focusing on SMB? Let's discuss.",
        time: "2024-11-27T18:00:00Z",
        platform: "Slack",
        channel: "Founders",
      },
    ],
    expected: {
      // urgency: "24h",
      importance: "high",
      myTasksCount: 1,
      tags: ["Strategy Discussion"],
    },
  },
  {
    id: "issue-157-r2-advisor-feedback",
    name: "Stable Relationship: Advisor Feedback",
    description: "Board member provides monthly feedback and strategic advice.",
    category: "R2",
    priority: "P1",
    userProfile: {
      name: "User Me",
      email: "me@example.com",
      role: "Founder",
    },
    messages: [
      {
        person: "Board Member",
        content:
          "Monthly check-in: Your growth metrics look solid. One concern - customer concentration is getting high. Consider diversifying.",
        time: "2024-11-27T19:00:00Z",
        platform: "Email",
        channel: "Inbox",
      },
    ],
    expected: {
      urgency: "not_urgent",
      importance: "high",
      insightCount: 1,
      tags: ["Advisor Feedback"],
    },
  },
  {
    id: "issue-158-r2-key-account-update",
    name: "Stable Relationship: Key Account Update",
    description: "Key customer's project manager sends weekly progress update.",
    category: "R2",
    priority: "P2",
    userProfile: {
      name: "User Me",
      email: "me@example.com",
      role: "Account Manager",
    },
    messages: [
      {
        person: "Client PM",
        content:
          "Week 12 update: Migration is 75% complete. On track for Dec 15 go-live. No blockers.",
        time: "2024-11-27T20:00:00Z",
        platform: "Email",
        channel: "Inbox",
      },
    ],
    expected: { urgency: "not_urgent", importance: "medium", insightCount: 1 },
  },
  {
    id: "issue-159-r2-cross-department",
    name: "Stable Relationship: Cross-Department Collaboration",
    description:
      "Other department head requests project sync and collaboration.",
    category: "R2",
    priority: "P2",
    userProfile: {
      name: "User Me",
      email: "me@example.com",
      role: "Engineering Lead",
    },
    messages: [
      {
        person: "Marketing Lead",
        content:
          "Hey, can we sync on the API docs for the new feature? Marketing wants to include it in the launch campaign.",
        time: "2024-11-27T21:00:00Z",
        platform: "Slack",
        channel: "Cross-Functional",
      },
    ],
    expected: {
      // urgency: "not_urgent",
      // importance: "medium",
      myTasksCount: 1,
    },
  },
  // R1 Extended: Super Individual Roles - Event-Driven
  {
    id: "issue-160-r1-crossborder-forex",
    name: "Event-Driven: Cross-Border Forex Crisis",
    description:
      "Cross-border business owner receives alert about major forex fluctuation affecting large order.",
    category: "R1",
    priority: "P0",
    userProfile: {
      name: "User Me",
      email: "me@example.com",
      role: "Cross-Border Business Owner",
    },
    messages: [
      {
        person: "Finance Team",
        content:
          "URGENT: USD/CNY jumped 3% overnight. Our $500K order margin is now negative. Need decision on hedging immediately.",
        time: "2024-11-28T08:00:00Z",
        platform: "WeChat",
        channel: "Finance",
      },
    ],
    expected: {
      urgency: "immediate",
      importance: "high",
      myTasksCount: 1,
      tags: ["Forex Risk"],
    },
  },
  {
    id: "issue-161-r1-investor-exit",
    name: "Event-Driven: Investor Exit Opportunity",
    description: "Investor receives acquisition offer for portfolio company.",
    category: "R1",
    priority: "P0",
    userProfile: {
      name: "User Me",
      email: "me@example.com",
      role: "Venture Investor",
    },
    messages: [
      {
        person: "Strategic Buyer",
        content:
          "We're interested in acquiring PortfolioCo for $50M. Can we schedule a call this week to discuss?",
        time: "2024-11-28T09:00:00Z",
        platform: "Email",
        channel: "Inbox",
      },
    ],
    expected: {
      // urgency: "immediate",
      importance: "high",
      myTasksCount: 1,
      tags: ["Exit Opportunity"],
    },
  },
  {
    id: "issue-162-r1-consultant-emergency",
    name: "Event-Driven: Consultant Emergency Request",
    description:
      "Independent consultant receives urgent request from client facing crisis.",
    category: "R1",
    priority: "P0",
    userProfile: {
      name: "User Me",
      email: "me@example.com",
      role: "Independent Consultant",
    },
    messages: [
      {
        person: "Client CEO",
        content:
          "Our CTO just resigned. Board meeting in 2 hours. Need your advice on interim plan ASAP.",
        time: "2024-11-28T10:00:00Z",
        platform: "WhatsApp",
        channel: "DM",
      },
    ],
    expected: {
      urgency: "immediate",
      importance: "high",
      myTasksCount: 1,
      tags: ["Client Emergency"],
    },
  },
  {
    id: "issue-163-r1-executive-regulatory",
    name: "Event-Driven: Executive Regulatory Audit",
    description:
      "Executive receives notice of regulatory audit requiring immediate response.",
    category: "R1",
    priority: "P0",
    userProfile: {
      name: "User Me",
      email: "me@example.com",
      role: "CEO",
    },
    messages: [
      {
        person: "Legal Counsel",
        content:
          "SEC just sent a document request. We have 48 hours to respond. Need to assemble the team now.",
        time: "2024-11-28T11:00:00Z",
        platform: "Email",
        channel: "Inbox",
      },
    ],
    expected: {
      urgency: "immediate",
      importance: "high",
      myTasksCount: 1,
      tags: ["Regulatory Audit"],
    },
  },
  {
    id: "issue-164-r1-fa-deal-feedback",
    name: "Event-Driven: FA Critical Deal Feedback",
    description:
      "Financial advisor receives buyer's feedback on term sheet with key changes.",
    category: "R1",
    priority: "P0",
    userProfile: {
      name: "User Me",
      email: "me@example.com",
      role: "Financial Advisor",
    },
    messages: [
      {
        person: "Buyer's Counsel",
        content:
          "Reviewed term sheet. Buyer wants to reduce valuation by 20% due to DD findings. Need response by EOD.",
        time: "2024-11-28T12:00:00Z",
        platform: "Email",
        channel: "Inbox",
      },
    ],
    expected: {
      urgency: "immediate",
      importance: "high",
      myTasksCount: 1,
      tags: ["Deal Progress"],
    },
  },
  // R2 Extended: Super Individual Roles - Stable Relationship
  {
    id: "issue-165-r2-crossborder-supplier",
    name: "Stable Relationship: Supplier Monthly Update",
    description:
      "Long-term overseas supplier sends monthly order confirmation.",
    category: "R2",
    priority: "P2",
    userProfile: {
      name: "User Me",
      email: "me@example.com",
      role: "Import Business Owner",
    },
    messages: [
      {
        person: "Supplier Manager",
        content:
          "November order confirmed: 10K units. Production starts next week. Estimated delivery Dec 20.",
        time: "2024-11-28T13:00:00Z",
        platform: "Email",
        channel: "Inbox",
      },
    ],
    expected: {
      urgency: "not_urgent",
      // importance: "medium",
      insightCount: 1,
    },
  },
  {
    id: "issue-166-r2-investor-portfolio",
    name: "Stable Relationship: Portfolio Company Monthly Report",
    description: "Portfolio company sends monthly operating metrics.",
    category: "R2",
    priority: "P1",
    userProfile: {
      name: "User Me",
      email: "me@example.com",
      role: "Investor",
    },
    messages: [
      {
        person: "Portfolio CEO",
        content:
          "November metrics: ARR $2.5M (+15% MoM), burn $200K/mo, runway 18 months. On track for Series A in Q2.",
        time: "2024-11-28T14:00:00Z",
        platform: "Email",
        channel: "Inbox",
      },
    ],
    expected: {
      urgency: "not_urgent",
      importance: "high",
      insightCount: 1,
      tags: ["Portfolio Report"],
    },
  },
  {
    id: "issue-167-r2-consultant-retainer",
    name: "Stable Relationship: Retainer Client Check-in",
    description:
      "Long-term retainer client requests regular strategic discussion.",
    category: "R2",
    priority: "P2",
    userProfile: {
      name: "User Me",
      email: "me@example.com",
      role: "Strategy Consultant",
    },
    messages: [
      {
        person: "Retainer Client",
        content:
          "Monthly check-in: Thinking about expanding to SEA market. Want to discuss market entry strategy next week?",
        time: "2024-11-28T15:00:00Z",
        platform: "Slack",
        channel: "Client",
      },
    ],
    expected: {
      // urgency: "24h",
      // importance: "high",
      myTasksCount: 1,
      tags: ["Client Inquiry"],
    },
  },
  {
    id: "issue-168-r2-executive-board",
    name: "Stable Relationship: Board Member Strategic Advice",
    description: "Board member provides strategic input on company direction.",
    category: "R2",
    priority: "P1",
    userProfile: {
      name: "User Me",
      email: "me@example.com",
      role: "CEO",
    },
    messages: [
      {
        person: "Board Member",
        content:
          "Reviewed Q4 numbers. Impressive growth but CAC is creeping up. Consider doubling down on product-led growth.",
        time: "2024-11-28T16:00:00Z",
        platform: "Email",
        channel: "Inbox",
      },
    ],
    expected: {
      urgency: "not_urgent",
      importance: "high",
      insightCount: 1,
      tags: ["Board Advice"],
    },
  },
  {
    id: "issue-169-r2-fa-network",
    name: "Stable Relationship: FA Network Deal Flow",
    description:
      "Fellow FA shares potential deal opportunity from their network.",
    category: "R2",
    priority: "P2",
    userProfile: {
      name: "User Me",
      email: "me@example.com",
      role: "M&A Advisor",
    },
    messages: [
      {
        person: "Fellow FA",
        content:
          "Know a SaaS company doing $5M ARR looking to sell. Fits your fintech focus. Want an intro?",
        time: "2024-11-28T17:00:00Z",
        platform: "LinkedIn",
        channel: "DM",
      },
    ],
    expected: { urgency: "24h", importance: "high", insightCount: 1 },
  },
  // ========== Knowledge & Memory ==========
  {
    id: "issue-170-o2-intro-recall",
    name: "Introduction Recall (The Connector)",
    description:
      "User (CEO) was introduced to a VC team 3 weeks ago. Roles were defined then. AI recalls the role and context from the intro.",
    category: "O2",
    priority: "P1",
    userProfile: {
      name: "User CEO",
      email: "ceo@example.com",
      role: "CEO",
    },
    messages: [
      {
        person: "VC Partner",
        content:
          "Great to meet you all! I'm Alice, leading the consumer tech investment at Venture Capital X. Looking forward to learning more about your product.",
        time: "2024-11-01T10:00:00Z",
        platform: "Telegram",
        channel: "Intro Group",
      },
      {
        person: "VC Associate",
        content:
          "Hi, I'm Bob, working with Alice on due diligence. I'll be digging into the data room.",
        time: "2024-11-01T10:05:00Z",
        platform: "Telegram",
        channel: "Intro Group",
      },
      {
        person: "VC Associate",
        content:
          "Hey User CEO, just following up on our last chat. Did you get a chance to upload the cohort analysis?",
        time: "2024-11-22T14:00:00Z",
        platform: "Telegram",
        channel: "Intro Group",
      },
    ],
    expected: {
      urgency: "24h",
      importance: "high",
      myTasksCount: 1,
      tags: ["Fundraising", "Due Diligence"],
    },
  },
  {
    id: "issue-171-o2-roadmap-recall",
    name: "Project Roadmap Recall",
    description:
      "User shared a Q3 roadmap 1 month ago. Team member asks about tracking. AI retrieves the specific goals.",
    category: "O2",
    priority: "P2",
    userProfile: {
      name: "User PM",
      email: "pm@example.com",
      role: "Product Manager",
    },
    messages: [
      {
        person: "User PM",
        content:
          "Here are our Q3 goals: 1. Launch Mobile App v2, 2. Reduce API latency by 30%, 3. Onboard 5 enterprise clients.",
        time: "2024-10-25T09:00:00Z",
        platform: "Slack",
        channel: "product-strategy",
      },
      {
        person: "Engineer",
        content:
          "Hey User PM, how are we tracking against the Q3 goals? Are we still prioritizing the API latency work?",
        time: "2024-11-25T11:00:00Z",
        platform: "Slack",
        channel: "product-strategy",
      },
    ],
    expected: {
      // urgency: "24h",
      importance: "medium",
      myTasksCount: 1,
      tags: ["Roadmap", "Q3 Goals"],
    },
  },
  {
    id: "issue-172-o2-decision-rationale",
    name: "Decision Rationale Recall",
    description:
      "Team debated SQL vs NoSQL 2 months ago. New engineer asks why. AI recalls the specific reasons.",
    category: "O2",
    priority: "P2",
    userProfile: {
      name: "User Tech Lead",
      email: "techlead@example.com",
      role: "Tech Lead",
    },
    messages: [
      {
        person: "User Tech Lead",
        content:
          "After reviewing the requirements, we're going with Postgres. We need strict ACID compliance for financial transactions, which Mongo doesn't guarantee well enough for our use case.",
        time: "2024-09-15T14:00:00Z",
        platform: "Slack",
        channel: "architecture",
      },
      {
        person: "New Engineer",
        content:
          "Hey @User Tech Lead, I'm setting up the new service. Just curious, why did we choose Postgres over Mongo for this?",
        time: "2024-11-25T10:00:00Z",
        platform: "Slack",
        channel: "architecture",
      },
    ],
    expected: {
      // urgency: "not_urgent",
      importance: "medium",
      myTasksCount: 1, // Answering a direct question is a task
      tags: ["Architecture Decision", "Onboarding"],
    },
  },
  {
    id: "issue-173-o2-doc-link-retrieval",
    name: "Document Link Retrieval",
    description:
      "User shared the API Spec v2 link 3 weeks ago. Someone asks for it. AI finds and provides the link.",
    category: "O2",
    priority: "P2",
    userProfile: {
      name: "User Dev",
      email: "dev@example.com",
    },
    messages: [
      {
        person: "User Dev",
        content:
          "Folks, the new API Spec v2 is ready for review: https://docs.example.com/api-v2",
        time: "2024-11-05T16:00:00Z",
        platform: "Discord",
        channel: "dev-team",
      },
      {
        person: "QA Engineer",
        content:
          "Can someone reshare the API spec link? I can't find it in the pinned messages.",
        time: "2024-11-26T09:30:00Z",
        platform: "Discord",
        channel: "dev-team",
      },
    ],
    expected: {
      // urgency: "immediate", // Unblocking a teammate is usually immediate/quick
      // importance: "low",
      myTasksCount: 0, // "Share link" is a not task
    },
  },
  {
    id: "issue-174-o2-meeting-followup-gap",
    name: "Meeting Follow-up (Long Gap)",
    description:
      "User said 'touch base in 2 weeks'. 2 weeks later someone asks 'Are we still on?'. AI identifies context.",
    category: "O2",
    priority: "P1",
    userProfile: {
      name: "User Sales",
      email: "sales@example.com",
    },
    messages: [
      {
        person: "User Sales",
        content:
          "Thanks for the demo. Let's touch base on the contract terms in 2 weeks once legal has reviewed it.",
        time: "2024-11-10T15:00:00Z",
        platform: "Email",
        channel: "Client Thread",
      },
      {
        person: "Client",
        content: "Hi User Sales, are we still on for this week?",
        time: "2024-11-24T09:00:00Z",
        platform: "Email",
        channel: "Client Thread",
      },
    ],
    expected: {
      urgency: "24h",
      importance: "high",
      myTasksCount: 1,
      tags: ["Contract Review", "Client Follow-up"],
    },
  },
  {
    id: "issue-175-o2-quote-validity",
    name: "Quote/Pricing Validity",
    description:
      "User gave a quote 1 month ago. Client asks if valid. AI recalls the figure.",
    category: "O2",
    priority: "P1",
    userProfile: {
      name: "User Freelancer",
      email: "freelancer@example.com",
    },
    messages: [
      {
        person: "User Freelancer",
        content:
          "I can do the migration for a fixed fee of $5,000, assuming the scope remains as discussed.",
        time: "2024-10-25T11:00:00Z",
        platform: "Upwork",
        channel: "DM",
      },
      {
        person: "Client",
        content:
          "We're finally ready to move forward. Is that rate still valid?",
        time: "2024-11-25T14:00:00Z",
        platform: "Upwork",
        channel: "DM",
      },
    ],
    expected: {
      // urgency: "immediate",
      // importance: "high",
      myTasksCount: 1,
      tags: ["Sales", "Pricing"],
    },
  },
  {
    id: "issue-176-o2-multi-round-recall",
    name: "Multi-Round Cross-Time Context Recall",
    description:
      "User has multi-round conversations with a partner over 6 weeks. When partner says 'Hi' weeks later, AI recalls their role, company, and key discussion points.",
    category: "O2",
    priority: "P1",
    userProfile: {
      name: "User CEO",
      email: "ceo@startup.com",
      role: "CEO",
    },
    messages: [
      {
        person: "Sarah Chen",
        content:
          "Hi! I'm Sarah from CloudScale Partners. We're a B2B SaaS infrastructure provider. Heard great things about your AI platform from mutual friend Tom. Would love to explore potential integration opportunities.",
        time: "2024-10-01T10:00:00Z",
        platform: "LinkedIn",
        channel: "DM",
      },
      {
        person: "User CEO",
        content:
          "Thanks Sarah! Yes, Tom mentioned you. We're building an AI agent platform for enterprise workflows. Happy to chat about integrations.",
        time: "2024-10-01T14:30:00Z",
        platform: "LinkedIn",
        channel: "DM",
      },
      {
        person: "Sarah Chen",
        content:
          "Perfect! Our cloud orchestration layer could be a great fit. We serve 200+ enterprise clients including Fortune 500s. Let me send over our API docs.",
        time: "2024-10-01T15:00:00Z",
        platform: "LinkedIn",
        channel: "DM",
      },
      {
        person: "Sarah Chen",
        content:
          "Just shared our technical overview. Key capabilities: auto-scaling, multi-region deployment, SOC2 compliant infrastructure. Our average customer saves 40% on cloud costs.",
        time: "2024-10-08T09:00:00Z",
        platform: "Email",
        channel: "Inbox",
      },
      {
        person: "User CEO",
        content:
          "Reviewed the docs. Impressive! The auto-scaling would solve our biggest pain point. Our enterprise clients are asking for better deployment options. Let's schedule a technical deep dive with my CTO.",
        time: "2024-10-10T11:00:00Z",
        platform: "Email",
        channel: "Inbox",
      },
      {
        person: "Sarah Chen",
        content:
          "Great! Had the tech call with your CTO yesterday. He mentioned you're targeting Q1 2025 for enterprise tier launch. We could offer early partner pricing - 30% discount for first year if we can be your preferred infrastructure partner.",
        time: "2024-10-22T16:00:00Z",
        platform: "Slack",
        channel: "CloudScale-Startup Partnership",
      },
      {
        person: "User CEO",
        content:
          "That's very attractive. Let me discuss with the board next week. Our main concern is the migration timeline - we need to be live by Feb 2025.",
        time: "2024-10-23T10:00:00Z",
        platform: "Slack",
        channel: "CloudScale-Startup Partnership",
      },
      {
        person: "Sarah Chen",
        content:
          "Hi! Hope you had a good weekend. Just following up on our partnership discussion. Any updates from the board meeting?",
        time: "2024-11-25T09:00:00Z",
        platform: "Slack",
        channel: "CloudScale-Startup Partnership",
      },
    ],
    expected: {
      urgency: "24h",
      importance: "high",
      myTasksCount: 1,
      tags: ["Partnership", "Infrastructure", "Board Decision"],
      // AI should recall:
      // - Sarah's role: from CloudScale Partners
      // - Company: B2B SaaS infrastructure provider with 200+ enterprise clients
      // - Key points: auto-scaling solution, Q1 2025 launch target, 30% discount offer, Feb 2025 deadline, pending board decision
      // - Context: This is a follow-up on partnership pricing discussion after board meeting
    },
  },
  // ========== Mixed Long Conversations ==========
  {
    id: "issue-177-mixed-tech-community-long",
    name: "Mixed: Tech Community Long Discussion (Role Memory + False Positive + Attribution)",
    description:
      "Long tech community discussion mixing role-based assignment, false positive prevention, and correct attribution over 3 weeks.",
    category: "O2",
    priority: "P0",
    userProfile: {
      name: "Alex Chen",
      email: "alex@devtools.com",
      role: "DevRel Engineer",
    },
    messages: [
      {
        person: "Alex Chen",
        content:
          "Hey everyone! I'm Alex, DevRel engineer at DevTools Inc. I handle developer onboarding, documentation, and community support. Feel free to tag me for any integration questions!",
        time: "2024-11-01T09:00:00Z",
        platform: "Discord",
        channel: "web3-builders",
      },
      {
        person: "User A",
        content:
          "Welcome Alex! Quick question - does your platform support Rust smart contracts?",
        time: "2024-11-01T09:15:00Z",
        platform: "Discord",
        channel: "web3-builders",
      },
      {
        person: "User B",
        content:
          "I'm getting error 'connection timeout' when deploying. Anyone else seeing this?",
        time: "2024-11-01T10:00:00Z",
        platform: "Discord",
        channel: "web3-builders",
      },
      {
        person: "User C",
        content: "Same here. Looks like a network issue.",
        time: "2024-11-01T10:05:00Z",
        platform: "Discord",
        channel: "web3-builders",
      },
      {
        person: "User D",
        content:
          "Just pushed a fix for the timeout issue. Should be resolved now.",
        time: "2024-11-01T11:00:00Z",
        platform: "Discord",
        channel: "web3-builders",
      },
      {
        person: "User E",
        content: "Thanks User D! Working now.",
        time: "2024-11-01T11:30:00Z",
        platform: "Discord",
        channel: "web3-builders",
      },
      {
        person: "User F",
        content:
          "Hey team, we're organizing a hackathon next month. Send me your project ideas if interested!",
        time: "2024-11-08T14:00:00Z",
        platform: "Discord",
        channel: "web3-builders",
      },
      {
        person: "User G",
        content: "I'll DM you my idea. Working on a DeFi lending protocol.",
        time: "2024-11-08T14:30:00Z",
        platform: "Discord",
        channel: "web3-builders",
      },
      {
        person: "User H",
        content:
          "@Alex Chen Hey Alex! We're building a cross-chain bridge and need help with your SDK integration. The documentation mentions callback hooks but we're not sure how to implement them for async operations. Could you point us to examples or schedule a quick call?",
        time: "2024-11-22T16:00:00Z",
        platform: "Discord",
        channel: "web3-builders",
      },
    ],
    expected: {
      urgency: "24h",
      // importance: "high",
      myTasksCount: 2,
      waitingForOthersCount: 0,
      tags: ["SDK Integration", "Developer Support"],
    },
  },
  {
    id: "issue-178-mixed-sales-pipeline-long",
    name: "Mixed: Sales Pipeline Long Thread (Memory Recall + VIP Priority + Waiting Status)",
    description:
      "Sales pipeline discussion over 5 weeks with VIP client, testing memory recall, priority assessment, and waiting status management.",
    category: "O2",
    priority: "P0",
    userProfile: {
      name: "Sarah Kim",
      email: "sarah@saascompany.com",
      role: "Sales Director",
    },
    messages: [
      {
        person: "Enterprise Client | Fortune 100",
        content:
          "Hi Sarah, we're evaluating solutions for our global rollout. Need to support 50,000+ users across 20 countries. What's your pricing for enterprise tier?",
        time: "2024-10-15T10:00:00Z",
        platform: "Email",
        channel: "Inbox",
      },
      {
        person: "Sarah Kim",
        content:
          "Thanks for reaching out! For 50K users, we can offer $8/user/month with annual commitment. Includes 24/7 support, dedicated CSM, and custom SLA. Let me send over a detailed proposal.",
        time: "2024-10-15T15:00:00Z",
        platform: "Email",
        channel: "Inbox",
      },
      {
        person: "Enterprise Client | Fortune 100",
        content:
          "Proposal looks good. Our legal team will review the contract. They typically take 2-3 weeks. I'll keep you posted.",
        time: "2024-10-18T11:00:00Z",
        platform: "Email",
        channel: "Inbox",
      },
      {
        person: "Sarah Kim",
        content:
          "Perfect! Let me know if legal has any questions. Happy to jump on a call.",
        time: "2024-10-18T14:00:00Z",
        platform: "Email",
        channel: "Inbox",
      },
      {
        person: "Internal Sales Team",
        content:
          "Sarah, the Fortune 100 deal - any updates? It's been flagged as Q4 priority by leadership.",
        time: "2024-11-05T09:00:00Z",
        platform: "Slack",
        channel: "sales-pipeline",
      },
      {
        person: "Sarah Kim",
        content:
          "Waiting on their legal review. Should hear back this week based on their timeline.",
        time: "2024-11-05T09:30:00Z",
        platform: "Slack",
        channel: "sales-pipeline",
      },
      {
        person: "Enterprise Client | Fortune 100",
        content:
          "Sarah, legal approved! A few minor redlines on the data residency clauses. Can we schedule a call to finalize? Also, we'd like to move forward with a pilot for 5,000 users in EMEA region first.",
        time: "2024-11-20T08:00:00Z",
        platform: "Email",
        channel: "Inbox",
      },
    ],
    expected: {
      // urgency: "immediate", // VIP client + deal progression
      importance: "high",
      myTasksCount: 1, // Schedule call to finalize contract
      waitingForOthersCount: 0, // Legal review is complete
      tags: ["Enterprise Deal", "Contract Negotiation", "Q4 Priority"],
    },
  },
  {
    id: "issue-179-mixed-product-launch-long",
    name: "Mixed: Product Launch Coordination (Multi-Party + Role Memory + Dependency)",
    description:
      "Product launch coordination over 4 weeks with multiple stakeholders, testing multi-party coordination, role memory, and task dependencies.",
    category: "O2",
    priority: "P1",
    userProfile: {
      name: "Jamie Park",
      email: "jamie@productco.com",
      role: "Product Manager",
    },
    messages: [
      {
        person: "Jamie Park",
        content:
          "Team, kicking off our Q1 product launch planning. Target date: Feb 1st. Key workstreams: Engineering (feature complete by Jan 15), Marketing (campaign ready by Jan 20), Sales (training done by Jan 25). Let's sync weekly.",
        time: "2024-11-01T10:00:00Z",
        platform: "Slack",
        channel: "q1-launch",
      },
      {
        person: "Engineering Lead",
        content:
          "Jan 15 is tight but doable. We'll need design specs by Nov 15 to stay on track.",
        time: "2024-11-01T10:30:00Z",
        platform: "Slack",
        channel: "q1-launch",
      },
      {
        person: "Design Lead",
        content:
          "I can have initial mocks by Nov 10. Final specs by Nov 15 works.",
        time: "2024-11-01T11:00:00Z",
        platform: "Slack",
        channel: "q1-launch",
      },
      {
        person: "Marketing Lead",
        content:
          "For the campaign, I'll need final product screenshots and messaging by Jan 10. Can engineering commit to that?",
        time: "2024-11-08T14:00:00Z",
        platform: "Slack",
        channel: "q1-launch",
      },
      {
        person: "Engineering Lead",
        content: "Yes, Jan 10 for screenshots is fine.",
        time: "2024-11-08T14:15:00Z",
        platform: "Slack",
        channel: "q1-launch",
      },
      {
        person: "Sales Lead",
        content:
          "I'll need the product demo environment ready by Jan 20 for training. Also, what's the pricing model? Sales team is getting questions from prospects.",
        time: "2024-11-15T09:00:00Z",
        platform: "Slack",
        channel: "q1-launch",
      },
      {
        person: "Jamie Park",
        content:
          "Demo environment - Engineering can you confirm Jan 20? Pricing - I'll have a proposal by end of this week and share for feedback.",
        time: "2024-11-15T10:00:00Z",
        platform: "Slack",
        channel: "q1-launch",
      },
      {
        person: "Engineering Lead",
        content: "Jan 20 for demo env confirmed.",
        time: "2024-11-15T10:30:00Z",
        platform: "Slack",
        channel: "q1-launch",
      },
      {
        person: "CEO",
        content:
          "Jamie, board is asking about launch readiness. Can you send me a status update by EOD today? Specifically: are we on track for Feb 1, any blockers, and what's the go-to-market strategy?",
        time: "2024-11-25T15:00:00Z",
        platform: "Email",
        channel: "Inbox",
      },
    ],
    expected: {
      urgency: "immediate", // CEO request with EOD deadline
      importance: "high",
      myTasksCount: 2, // 1) Send status update to CEO, 2) Share pricing proposal (overdue from Nov 15)
      waitingForOthersCount: 3, // All dependencies confirmed
      tags: ["Product Launch", "Board Update", "Q1 Planning"],
    },
  },
  {
    id: "issue-180-mixed-investor-relations-long",
    name: "Mixed: Investor Relations Long Thread (VIP + Memory + Context Switch)",
    description:
      "Investor relations discussion over 8 weeks with multiple investors, testing VIP priority, memory recall, and context switching between different investor conversations.",
    category: "O2",
    priority: "P0",
    userProfile: {
      name: "Chris Wang",
      email: "chris@startup.io",
      role: "CEO",
    },
    messages: [
      {
        person: "VC Partner A | TechVentures",
        content:
          "Chris, great meeting you at the conference. TechVentures is interested in your Series A. We typically lead rounds of $10-15M for B2B SaaS at your stage. What's your current ARR and burn rate?",
        time: "2024-10-01T14:00:00Z",
        platform: "Email",
        channel: "Inbox",
      },
      {
        person: "Chris Wang",
        content:
          "Thanks! We're at $2.5M ARR, growing 15% MoM. Burn is $400K/month. Raising $12M Series A to accelerate sales and expand to EU market.",
        time: "2024-10-02T09:00:00Z",
        platform: "Email",
        channel: "Inbox",
      },
      {
        person: "Angel Investor B",
        content:
          "Hey Chris, heard you're raising. I invested in your seed round. Happy to participate in Series A. What's the valuation?",
        time: "2024-10-08T11:00:00Z",
        platform: "WhatsApp",
        channel: "DM",
      },
      {
        person: "Chris Wang",
        content:
          "Great to hear! We're targeting $50M pre-money. Will send you the deck.",
        time: "2024-10-08T15:00:00Z",
        platform: "WhatsApp",
        channel: "DM",
      },
      {
        person: "VC Partner C | GrowthFund",
        content:
          "Chris, we reviewed your deck. Impressive metrics! Our investment committee meets next Thursday. Can you present? They'll want to dig into unit economics and customer acquisition strategy.",
        time: "2024-10-22T10:00:00Z",
        platform: "Email",
        channel: "Inbox",
      },
      {
        person: "Chris Wang",
        content:
          "Absolutely! Thursday works. I'll prepare deep dive on CAC/LTV and cohort analysis.",
        time: "2024-10-22T16:00:00Z",
        platform: "Email",
        channel: "Inbox",
      },
      {
        person: "VC Partner A | TechVentures",
        content:
          "Chris, our partners discussed your round. We're interested in co-leading with another firm. Have you talked to GrowthFund? We've co-invested before and think it could be a good fit.",
        time: "2024-11-05T09:00:00Z",
        platform: "Email",
        channel: "Inbox",
      },
      {
        person: "Chris Wang",
        content:
          "Yes! Actually presenting to GrowthFund's IC next week. That could work well. Let's sync after their decision.",
        time: "2024-11-05T11:00:00Z",
        platform: "Email",
        channel: "Inbox",
      },
      {
        person: "VC Partner C | GrowthFund",
        content:
          "Great presentation yesterday! IC voted to move forward. We'd like to offer a term sheet for $6M at $50M pre. Can we schedule a call to discuss terms? Also, heard TechVentures is interested - happy to co-lead if that works for you.",
        time: "2024-11-15T08:00:00Z",
        platform: "Email",
        channel: "Inbox",
      },
      {
        person: "Angel Investor B",
        content:
          "Chris, any update on the round? Still interested in participating.",
        time: "2024-11-20T10:00:00Z",
        platform: "WhatsApp",
        channel: "DM",
      },
      {
        person: "VC Partner A | TechVentures",
        content:
          "Hi Chris, following up on our last conversation. Heard GrowthFund made an offer. We'd like to co-lead with them for the other $6M. Can we finalize terms this week? Our partnership team is ready to move quickly.",
        time: "2024-11-25T14:00:00Z",
        platform: "Email",
        channel: "Inbox",
      },
    ],
    expected: {
      // urgency: "immediate", // Term sheet on the table, time-sensitive
      importance: "high",
      myTasksCount: 2, // 1) Schedule call with GrowthFund, 2) Finalize terms with TechVentures
      waitingForOthersCount: 1,
      tags: ["Series A Fundraising", "Term Sheet", "Co-lead Deal"],
      // AI should recall:
      // - TechVentures: interested in co-leading, typical check size $10-15M
      // - GrowthFund: offered $6M term sheet at $50M pre after IC presentation
      // - Angel Investor B: seed investor, wants to participate
      // - Context: Both VCs want to co-lead $12M round ($6M each)
    },
  },
  {
    id: "issue-180-insight-benchmerge",
    name: "Mixed: Product Launch Coordination (Multi-Party + Role Memory + Dependency)",
    description:
      "Product launch coordination over 4 weeks with multiple stakeholders, testing multi-party coordination, role memory, and task dependencies.",
    category: "O2",
    priority: "P1",
    userProfile: {
      name: "Jamie Park",
      email: "jamie@productco.com",
      role: "Product Manager",
    },
    insights: [
      {
        taskLabel: "SONIC Project Launch Notification",
        title: "SONIC Project Marketing Launch Starting Soon",
        description:
          "Pike repeatedly posted a notification in the SONIC channel, announcing that the project will launch in 4 hours and 3 minutes (UTC 19:00) on the PK platform with a marketing budget of $350,000.",
        importance: "low",
        urgency: "immediate",
        platform: "telegram",
        account: "timigaberiel",
        groups: ["SONIC / DEC 9 / 19:00 UTC"],
        people: ["Pike"],
        time: new Date(),
      },
    ],
    messages: [
      {
        person: "Pike",
        content:
          "Hello, Everyone. SONIC marketing campaign is now complete, please be aware",
        time: "2024-11-01T10:00:00Z",
        platform: "telegram",
        channel: "Earn $SONIC",
      },
    ],
    expected: {
      insightCount: 1,
      myTasksCount: 0,
      waitingForOthersCount: 0,
    },
  },
  // ========== Insight Merge Tests ==========
  {
    id: "insight-merge-01-same-topic-consecutive",
    name: "Same Topic - Should Merge Into Single Insight",
    description:
      "Multiple consecutive messages about the same topic (project update) should be merged into one insight, not separate insights.",
    category: "O1",
    priority: "P1",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
      role: "Product Manager",
    },
    messages: [
      {
        person: "User B",
        content: "I've finished the API integration for Project Alpha.",
        time: "2024-12-26T09:00:00Z",
        platform: "Slack",
        channel: "project-alpha",
      },
      {
        person: "User B",
        content: "The integration passed all tests. Ready for deployment.",
        time: "2024-12-26T09:05:00Z",
        platform: "Slack",
        channel: "project-alpha",
      },
      {
        person: "User B",
        content: "Deployment scheduled for tomorrow morning.",
        time: "2024-12-26T09:10:00Z",
        platform: "Slack",
        channel: "project-alpha",
      },
    ],
    expected: {
      insightCount: 1, // Should merge into one insight about Project Alpha API completion
    },
  },
  {
    id: "insight-merge-02-different-topics-same-channel",
    name: "Different Topics - Should Separate Into Multiple Insights",
    description:
      "Messages about different topics in the same channel should be separated into different insights.",
    category: "A3",
    priority: "P1",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
      role: "Product Manager",
    },
    messages: [
      {
        person: "User B",
        content: "Project Alpha API is ready for deployment.",
        time: "2024-12-26T09:00:00Z",
        platform: "Slack",
        channel: "engineering",
      },
      {
        person: "User C",
        content: "The marketing campaign budget needs approval by Friday.",
        time: "2024-12-26T09:05:00Z",
        platform: "Slack",
        channel: "engineering",
      },
      {
        person: "User D",
        content: "Server maintenance is scheduled for Sunday.",
        time: "2024-12-26T09:10:00Z",
        platform: "Slack",
        channel: "engineering",
      },
    ],
    expected: {
      insightCount: 3, // Should separate into 3 insights: API deployment, marketing budget, server maintenance
    },
  },
  {
    id: "insight-merge-03-cross-platform-same-topic",
    name: "Cross-Platform Same Topic - Should Merge",
    description:
      "Messages about the same topic across different platforms should be merged into one insight.",
    category: "E1",
    priority: "P1",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
      role: "Product Manager",
    },
    messages: [
      {
        person: "User B",
        content: "Project Alpha deployment is scheduled for tomorrow at 10 AM.",
        time: "2024-12-26T09:00:00Z",
        platform: "Slack",
        channel: "project-alpha",
      },
      {
        person: "User B",
        content: "Reminder: Project Alpha deployment tomorrow at 10 AM UTC.",
        time: "2024-12-26T09:30:00Z",
        platform: "Telegram",
        channel: "Project Alpha Updates",
      },
      {
        person: "User B",
        content: "I'll send the deployment checklist in an hour.",
        time: "2024-12-26T10:00:00Z",
        platform: "Discord",
        channel: "general",
      },
    ],
    expected: {
      insightCount: 1, // Should merge across platforms into one insight about Project Alpha deployment
    },
  },
  {
    id: "insight-merge-04-conversation-thread",
    name: "Conversation Thread - Should Merge Into Single Insight",
    description:
      "A conversation thread about a specific topic should be merged into one insight.",
    category: "O1",
    priority: "P1",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
      role: "Engineering Manager",
    },
    messages: [
      {
        person: "User B",
        content: "We're seeing a memory leak in the payment service.",
        time: "2024-12-26T09:00:00Z",
        platform: "Slack",
        channel: "engineering",
      },
      {
        person: "User C",
        content: "I can investigate. Any specific patterns?",
        time: "2024-12-26T09:05:00Z",
        platform: "Slack",
        channel: "engineering",
      },
      {
        person: "User B",
        content: "It happens after processing large transactions.",
        time: "2024-12-26T09:10:00Z",
        platform: "Slack",
        channel: "engineering",
      },
      {
        person: "User C",
        content: "Got it. I'll check the connection pooling logic.",
        time: "2024-12-26T09:15:00Z",
        platform: "Slack",
        channel: "engineering",
      },
    ],
    expected: {
      insightCount: 1, // Should merge into one insight about the memory leak investigation
    },
  },
  {
    id: "insight-merge-05-time-separated-same-topic",
    name: "Time-Separated Same Topic - Should Merge",
    description:
      "Messages about the same topic but separated by time should still be merged if contextually related.",
    category: "E2",
    priority: "P2",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
      role: "Product Manager",
    },
    messages: [
      {
        person: "User B",
        content: "I'll start working on the Q1 roadmap today.",
        time: "2024-12-26T09:00:00Z",
        platform: "Slack",
        channel: "planning",
      },
      {
        person: "User B",
        content: "Q1 roadmap draft is ready for review.",
        time: "2024-12-26T14:00:00Z",
        platform: "Slack",
        channel: "planning",
      },
      {
        person: "User B",
        content: "Q1 roadmap has been approved. Moving to execution phase.",
        time: "2024-12-26T18:00:00Z",
        platform: "Slack",
        channel: "planning",
      },
    ],
    expected: {
      insightCount: 1, // Should merge into one insight about Q1 roadmap progress
    },
  },
  {
    id: "insight-merge-06-multiple-projects",
    name: "Multiple Projects - Should Not Merge",
    description:
      "Messages about different projects should NOT be merged, even if they discuss similar activities.",
    category: "A3",
    priority: "P1",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
      role: "Engineering Manager",
    },
    messages: [
      {
        person: "User B",
        content: "Project Alpha deployment scheduled for tomorrow.",
        time: "2024-12-26T09:00:00Z",
        platform: "Slack",
        channel: "engineering",
      },
      {
        person: "User C",
        content: "Project Beta deployment scheduled for Friday.",
        time: "2024-12-26T09:05:00Z",
        platform: "Slack",
        channel: "engineering",
      },
      {
        person: "User D",
        content: "Project Gamma is entering QA phase.",
        time: "2024-12-26T09:10:00Z",
        platform: "Slack",
        channel: "engineering",
      },
    ],
    expected: {
      insightCount: 3, // Should separate into 3 insights for each project
    },
  },
  {
    id: "insight-merge-07-related-but-distinct",
    name: "Related But Distinct Topics - Should Separate",
    description:
      "Topics that are related but represent distinct insights should not be merged.",
    category: "O1",
    priority: "P1",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
      role: "CTO",
    },
    messages: [
      {
        person: "User B",
        content:
          "We need to hire 2 senior frontend developers for the dashboard project.",
        time: "2024-12-26T09:00:00Z",
        platform: "Slack",
        channel: "hiring",
      },
      {
        person: "User C",
        content:
          "Backend API team needs 3 additional engineers for the microservices migration.",
        time: "2024-12-26T09:05:00Z",
        platform: "Slack",
        channel: "hiring",
      },
      {
        person: "User D",
        content: "DevOps team is looking for a site reliability engineer.",
        time: "2024-12-26T09:10:00Z",
        platform: "Slack",
        channel: "hiring",
      },
    ],
    expected: {
      insightCount: 3, // Should separate into 3 insights: frontend, backend, devops hiring
    },
  },
  {
    id: "insight-merge-08-status-update-followup",
    name: "Status Update with Follow-up - Should Merge",
    description:
      "Initial status update and follow-up clarification should be merged into one insight.",
    category: "O1",
    priority: "P1",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
      role: "Product Manager",
    },
    messages: [
      {
        person: "User B",
        content: "The user authentication feature is 80% complete.",
        time: "2024-12-26T09:00:00Z",
        platform: "Telegram",
        channel: "Product Dev",
      },
      {
        person: "User A",
        content: "Great! When do you expect it to be fully done?",
        time: "2024-12-26T09:05:00Z",
        platform: "Telegram",
        channel: "Product Dev",
      },
      {
        person: "User B",
        content:
          "Should be ready by EOD Wednesday. Testing the OAuth flow now.",
        time: "2024-12-26T09:10:00Z",
        platform: "Telegram",
        channel: "Product Dev",
      },
    ],
    expected: {
      insightCount: 1, // Should merge into one insight about auth feature progress
    },
  },
  {
    id: "insight-merge-09-interruption-new-topic",
    name: "Conversation Interruption with New Topic - Should Separate",
    description:
      "When a conversation is interrupted by a completely different topic, they should be separated into different insights.",
    category: "O1",
    priority: "P1",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
      role: "Engineering Manager",
    },
    messages: [
      {
        person: "User B",
        content: "The API gateway migration is progressing well.",
        time: "2024-12-26T09:00:00Z",
        platform: "Slack",
        channel: "engineering",
      },
      {
        person: "User C",
        content: "Has anyone seen my coffee mug?",
        time: "2024-12-26T09:02:00Z",
        platform: "Slack",
        channel: "engineering",
      },
      {
        person: "User D",
        content: "Check the kitchen upstairs.",
        time: "2024-12-26T09:03:00Z",
        platform: "Slack",
        channel: "engineering",
      },
      {
        person: "User B",
        content:
          "Back to the migration - we've completed the load balancer setup.",
        time: "2024-12-26T09:10:00Z",
        platform: "Slack",
        channel: "engineering",
      },
    ],
    expected: {
      insightCount: 2, // Should separate: API migration (continues) and coffee mug (interruption)
    },
  },
  {
    id: "insight-merge-10-decision-discussion",
    name: "Decision Discussion - Should Merge Into Single Insight",
    description:
      "A discussion leading to a decision should be merged into one insight that captures the decision.",
    category: "O1",
    priority: "P1",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
      role: "Product Manager",
    },
    messages: [
      {
        person: "User B",
        content:
          "Should we move the product launch to January or stick with December?",
        time: "2024-12-26T09:00:00Z",
        platform: "Telegram",
        channel: "Product Strategy",
      },
      {
        person: "User C",
        content:
          "January would be better - gives us more time for testing and marketing prep.",
        time: "2024-12-26T09:05:00Z",
        platform: "Telegram",
        channel: "Product Strategy",
      },
      {
        person: "User D",
        content:
          "I agree with January. Holiday season in December might be too chaotic.",
        time: "2024-12-26T09:10:00Z",
        platform: "Telegram",
        channel: "Product Strategy",
      },
      {
        person: "User A",
        content: "OK, decided. We're moving the launch to January 15th.",
        time: "2024-12-26T09:15:00Z",
        platform: "Telegram",
        channel: "Product Strategy",
      },
    ],
    expected: {
      insightCount: 1, // Should merge into one insight about the launch date decision
    },
  },
  {
    id: "insight-merge-11-task-delegation",
    name: "Task Delegation Discussion - Should Merge",
    description:
      "Discussion about delegating a task should be merged into one insight about the task assignment.",
    category: "I3",
    priority: "P1",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
      role: "Engineering Manager",
    },
    messages: [
      {
        person: "User B",
        content: "I need someone to handle the database optimization task.",
        time: "2024-12-26T09:00:00Z",
        platform: "Slack",
        channel: "engineering",
      },
      {
        person: "User C",
        content:
          "I can take it. I have experience with PostgreSQL optimization.",
        time: "2024-12-26T09:05:00Z",
        platform: "Slack",
        channel: "engineering",
      },
      {
        person: "User B",
        content: "Perfect! I'll assign it to you. Expect to start next week.",
        time: "2024-12-26T09:10:00Z",
        platform: "Slack",
        channel: "engineering",
      },
      {
        person: "User C",
        content: "Sounds good. I'll prepare the optimization plan first.",
        time: "2024-12-26T09:15:00Z",
        platform: "Slack",
        channel: "engineering",
      },
    ],
    expected: {
      insightCount: 1, // Should merge into one insight about task assignment
      myTasksCount: 0, // User A is not involved in the task
    },
  },
  {
    id: "insight-merge-12-multi-party-conversation",
    name: "Multi-Party Conversation on Single Topic - Should Merge",
    description:
      "A conversation involving multiple people discussing one topic should be merged into one insight.",
    category: "O1",
    priority: "P1",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
      role: "Product Manager",
    },
    messages: [
      {
        person: "User B",
        content: "We need to decide on the pricing model for the new feature.",
        time: "2024-12-26T09:00:00Z",
        platform: "Telegram",
        channel: "Product Discussion",
      },
      {
        person: "User C",
        content: "I suggest a tiered pricing structure.",
        time: "2024-12-26T09:05:00Z",
        platform: "Telegram",
        channel: "Product Discussion",
      },
      {
        person: "User D",
        content: "Tiered pricing works well. Maybe $9, $29, and $99 per month?",
        time: "2024-12-26T09:10:00Z",
        platform: "Telegram",
        channel: "Product Discussion",
      },
      {
        person: "User B",
        content: "Those numbers look reasonable. Let's go with that.",
        time: "2024-12-26T09:15:00Z",
        platform: "Telegram",
        channel: "Product Discussion",
      },
    ],
    expected: {
      insightCount: 1, // Should merge into one insight about pricing decision
    },
  },
  {
    id: "insight-merge-13-similar-keywords-different-context",
    name: "Similar Keywords Different Context - Should Separate",
    description:
      "Messages with similar keywords but in different contexts should be separated.",
    category: "E3",
    priority: "P1",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
      role: "Engineering Manager",
    },
    messages: [
      {
        person: "User B",
        content: "We need to deploy the payment API to production.",
        time: "2024-12-26T09:00:00Z",
        platform: "Slack",
        channel: "engineering",
      },
      {
        person: "User C",
        content: "The payment gateway API documentation needs to be updated.",
        time: "2024-12-26T09:05:00Z",
        platform: "Slack",
        channel: "engineering",
      },
      {
        person: "User D",
        content: "Payment API integration tests are failing.",
        time: "2024-12-26T09:10:00Z",
        platform: "Slack",
        channel: "engineering",
      },
    ],
    expected: {
      insightCount: 3, // Should separate: deployment, documentation, tests (different aspects)
    },
  },
  {
    id: "insight-merge-14-event-planning",
    name: "Event Planning Conversation - Should Merge",
    description:
      "Messages about planning a specific event should be merged into one insight.",
    category: "O1",
    priority: "P1",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
      role: "Marketing Manager",
    },
    messages: [
      {
        person: "User B",
        content: "We should host a launch party for the new product.",
        time: "2024-12-26T09:00:00Z",
        platform: "Telegram",
        channel: "Marketing",
      },
      {
        person: "User C",
        content: "Good idea! When and where?",
        time: "2024-12-26T09:05:00Z",
        platform: "Telegram",
        channel: "Marketing",
      },
      {
        person: "User B",
        content: "Thinking mid-January. Maybe at the downtown venue?",
        time: "2024-12-26T09:10:00Z",
        platform: "Telegram",
        channel: "Marketing",
      },
      {
        person: "User D",
        content: "I can help with the catering arrangements.",
        time: "2024-12-26T09:15:00Z",
        platform: "Telegram",
        channel: "Marketing",
      },
    ],
    expected: {
      insightCount: 1, // Should merge into one insight about launch party planning
    },
  },
  {
    id: "insight-merge-15-issue-resolution",
    name: "Issue Resolution Thread - Should Merge",
    description:
      "A thread discussing and resolving an issue should be merged into one insight.",
    category: "O1",
    priority: "P1",
    userProfile: {
      name: "User A",
      email: "user.a@example.com",
      role: "Engineering Manager",
    },
    messages: [
      {
        person: "User B",
        content: "We're getting 500 errors on the checkout page.",
        time: "2024-12-26T09:00:00Z",
        platform: "Slack",
        channel: "incidents",
      },
      {
        person: "User C",
        content: "Investigating... looks like a database connection issue.",
        time: "2024-12-26T09:05:00Z",
        platform: "Slack",
        channel: "incidents",
      },
      {
        person: "User C",
        content:
          "Found it. Connection pool is exhausted. Restarting the service.",
        time: "2024-12-26T09:10:00Z",
        platform: "Slack",
        channel: "incidents",
      },
      {
        person: "User C",
        content: "Service is back up. Errors have stopped.",
        time: "2024-12-26T09:20:00Z",
        platform: "Slack",
        channel: "incidents",
      },
    ],
    expected: {
      insightCount: 1, // Should merge into one insight about incident resolution
    },
  },
  // ========== Complex Insight Merge Tests ==========
  {
    id: "insight-complex-01-project-status-accumulation",
    name: "Project Status Accumulation - Multiple Updates to Same Insight",
    description:
      "Multiple status updates about Project Phoenix should be accumulated into a single insight, updating the status over time.",
    category: "O2",
    priority: "P1",
    userProfile: {
      name: "Sarah Chen",
      email: "sarah@techcorp.com",
      role: "Engineering Manager",
    },
    insights: [
      {
        taskLabel: "Project Phoenix Progress Update",
        title: "Project Phoenix API Development Progress",
        description:
          "User B is developing the Project Phoenix API and is expected to complete the core functionality this week.",
        importance: "medium",
        urgency: "not_urgent",
        platform: "slack",
        account: "techcorp",
        groups: ["engineering", "project-phoenix"],
        people: ["User B"],
        time: new Date("2024-12-26T09:00:00Z"),
        details: [
          {
            time: new Date("2024-12-26T09:00:00Z").getTime(),
            person: "User B",
            platform: "slack",
            channel: "project-phoenix",
            content:
              "I've started working on the Project Phoenix API endpoints.",
          },
          {
            time: new Date("2024-12-26T14:00:00Z").getTime(),
            person: "User B",
            platform: "slack",
            channel: "project-phoenix",
            content:
              "API authentication module is now complete. Moving to data processing.",
          },
          {
            time: new Date("2024-12-26T18:00:00Z").getTime(),
            person: "User B",
            platform: "slack",
            channel: "project-phoenix",
            content:
              "All core API features are done. Starting QA testing tomorrow.",
          },
        ],
      },
    ],
    messages: [
      {
        person: "User B",
        content: "I've started working on the Project Phoenix API endpoints.",
        time: "2024-12-26T09:00:00Z",
        platform: "Slack",
        channel: "project-phoenix",
      },
      {
        person: "User B",
        content:
          "API authentication module is now complete. Moving to data processing.",
        time: "2024-12-26T14:00:00Z",
        platform: "Slack",
        channel: "project-phoenix",
      },
      {
        person: "User B",
        content:
          "All core API features are done. Starting QA testing tomorrow.",
        time: "2024-12-26T18:00:00Z",
        platform: "Slack",
        channel: "project-phoenix",
      },
    ],
    expected: {
      insightCount: 1, // Should accumulate all updates into one insight
      myTasksCount: 0,
    },
  },
  {
    id: "insight-complex-02-decision-evolution",
    name: "Decision Evolution - Insight Updates as Decision Progresses",
    description:
      "A decision-making process that evolves over time should update the same insight as the decision moves from discussion to final choice.",
    category: "O2",
    priority: "P1",
    userProfile: {
      name: "John Smith",
      email: "john@startup.io",
      role: "CTO",
    },
    insights: [
      {
        taskLabel: "Tech Stack Selection Discussion",
        title: "Frontend Framework Selection In Progress",
        description:
          "The team is discussing whether to migrate to React, considering factors including performance, development efficiency, and team familiarity.",
        importance: "high",
        urgency: "24h",
        platform: "telegram",
        account: "tech-lead",
        groups: ["Tech Discussion"],
        people: ["User B", "User C", "User D"],
        time: new Date("2024-12-26T09:00:00Z"),
        details: [
          {
            time: new Date("2024-12-26T09:00:00Z").getTime(),
            person: "User B",
            platform: "telegram",
            channel: "Tech Discussion",
            content:
              "We need to decide on the frontend framework for the new project. React vs Vue?",
          },
          {
            time: new Date("2024-12-26T09:30:00Z").getTime(),
            person: "User C",
            platform: "telegram",
            channel: "Tech Discussion",
            content:
              "React has better ecosystem support, but Vue is easier to learn.",
          },
          {
            time: new Date("2024-12-26T10:00:00Z").getTime(),
            person: "User D",
            platform: "telegram",
            channel: "Tech Discussion",
            content: "Our team already knows React. Migration would be faster.",
          },
          {
            time: new Date("2024-12-26T10:30:00Z").getTime(),
            person: "User B",
            platform: "telegram",
            channel: "Tech Discussion",
            content:
              "OK, decided. We're going with React for better ecosystem and team familiarity.",
          },
        ],
      },
    ],
    messages: [
      {
        person: "User B",
        content:
          "We need to decide on the frontend framework for the new project. React vs Vue?",
        time: "2024-12-26T09:00:00Z",
        platform: "Telegram",
        channel: "Tech Discussion",
      },
      {
        person: "User C",
        content:
          "React has better ecosystem support, but Vue is easier to learn.",
        time: "2024-12-26T09:30:00Z",
        platform: "Telegram",
        channel: "Tech Discussion",
      },
      {
        person: "User D",
        content: "Our team already knows React. Migration would be faster.",
        time: "2024-12-26T10:00:00Z",
        platform: "Telegram",
        channel: "Tech Discussion",
      },
      {
        person: "User B",
        content:
          "OK, decided. We're going with React for better ecosystem and team familiarity.",
        time: "2024-12-26T10:30:00Z",
        platform: "Telegram",
        channel: "Tech Discussion",
      },
    ],
    expected: {
      insightCount: 1, // Should update the same insight as decision progresses
    },
  },
  {
    id: "insight-complex-03-issue-tracking",
    name: "Issue Tracking - From Report to Resolution",
    description:
      "Track an issue from initial report through investigation to resolution, updating the same insight throughout the lifecycle.",
    category: "O2",
    priority: "P1",
    userProfile: {
      name: "Mike Johnson",
      email: "mike@devops.co",
      role: "DevOps Lead",
    },
    insights: [
      {
        taskLabel: "Production Environment Issue",
        title: "Payment Service Latency Detected",
        description:
          "Reports received that payment service response times are abnormal, User C is investigating.",
        importance: "high",
        urgency: "immediate",
        platform: "slack",
        account: "devops-team",
        groups: ["incidents", "payment-service"],
        people: ["User C"],
        time: new Date("2024-12-26T09:00:00Z"),
        details: [
          {
            time: new Date("2024-12-26T09:00:00Z").getTime(),
            person: "User B",
            platform: "slack",
            channel: "incidents",
            content:
              "We're seeing high latency on the payment service. Users are complaining.",
          },
          {
            time: new Date("2024-12-26T09:10:00Z").getTime(),
            person: "User C",
            platform: "slack",
            channel: "incidents",
            content:
              "Investigating now. Looks like database query performance issue.",
          },
          {
            time: new Date("2024-12-26T09:20:00Z").getTime(),
            person: "User C",
            platform: "slack",
            channel: "incidents",
            content: "Found the slow query. Adding index now. ETA 10 minutes.",
          },
          {
            time: new Date("2024-12-26T09:35:00Z").getTime(),
            person: "User C",
            platform: "slack",
            channel: "incidents",
            content:
              "Index added. Latency is back to normal. Incident resolved.",
          },
        ],
      },
    ],
    messages: [
      {
        person: "User B",
        content:
          "We're seeing high latency on the payment service. Users are complaining.",
        time: "2024-12-26T09:00:00Z",
        platform: "Slack",
        channel: "incidents",
      },
      {
        person: "User C",
        content:
          "Investigating now. Looks like database query performance issue.",
        time: "2024-12-26T09:10:00Z",
        platform: "Slack",
        channel: "incidents",
      },
      {
        person: "User C",
        content: "Found the slow query. Adding index now. ETA 10 minutes.",
        time: "2024-12-26T09:20:00Z",
        platform: "Slack",
        channel: "incidents",
      },
      {
        person: "User C",
        content: "Index added. Latency is back to normal. Incident resolved.",
        time: "2024-12-26T09:35:00Z",
        platform: "Slack",
        channel: "incidents",
      },
    ],
    expected: {
      insightCount: 1, // Should track issue lifecycle in one insight
      waitingForOthersCount: 0,
    },
  },
  {
    id: "insight-complex-04-meeting-outcome",
    name: "Meeting Outcome - From Planning to Action Items",
    description:
      "Meeting planning and subsequent action items should be captured in a single insight that evolves from scheduling to outcomes.",
    category: "O2",
    priority: "P1",
    userProfile: {
      name: "Emily Davis",
      email: "emily@productco.com",
      role: "Product Manager",
    },
    insights: [
      {
        taskLabel: "Product Planning Meeting",
        title: "Q1 Product Planning Meeting Scheduled",
        description:
          "Q1 product planning meeting is scheduled for this Friday at 2 PM, User B, User C, and User D will attend.",
        importance: "medium",
        urgency: "24h",
        platform: "telegram",
        account: "pm-team",
        groups: ["Product Planning"],
        people: ["User B", "User C", "User D"],
        time: new Date("2024-12-26T09:00:00Z"),
        details: [
          {
            time: new Date("2024-12-26T09:00:00Z").getTime(),
            person: "User B",
            platform: "telegram",
            channel: "Product Planning",
            content:
              "Let's schedule the Q1 planning meeting for this Friday 2 PM.",
          },
          {
            time: new Date("2024-12-26T09:05:00Z").getTime(),
            person: "User C",
            platform: "telegram",
            channel: "Product Planning",
            content: "I can make it. User D, are you available?",
          },
          {
            time: new Date("2024-12-26T09:10:00Z").getTime(),
            person: "User D",
            platform: "telegram",
            channel: "Product Planning",
            content: "Yes, Friday 2 PM works for me.",
          },
          {
            time: new Date("2024-12-26T09:15:00Z").getTime(),
            person: "User B",
            platform: "telegram",
            channel: "Product Planning",
            content:
              "Great, meeting set. Agenda: roadmap review, feature prioritization, resource allocation.",
          },
          {
            time: new Date("2024-12-26T15:00:00Z").getTime(),
            person: "User B",
            platform: "telegram",
            channel: "Product Planning",
            content:
              "Meeting completed. Action items: User C to finalize feature list, User D to prepare budget proposal.",
          },
        ],
      },
    ],
    messages: [
      {
        person: "User B",
        content: "Let's schedule the Q1 planning meeting for this Friday 2 PM.",
        time: "2024-12-26T09:00:00Z",
        platform: "Telegram",
        channel: "Product Planning",
      },
      {
        person: "User C",
        content: "I can make it. User D, are you available?",
        time: "2024-12-26T09:05:00Z",
        platform: "Telegram",
        channel: "Product Planning",
      },
      {
        person: "User D",
        content: "Yes, Friday 2 PM works for me.",
        time: "2024-12-26T09:10:00Z",
        platform: "Telegram",
        channel: "Product Planning",
      },
      {
        person: "User B",
        content:
          "Great, meeting set. Agenda: roadmap review, feature prioritization, resource allocation.",
        time: "2024-12-26T09:15:00Z",
        platform: "Telegram",
        channel: "Product Planning",
      },
      {
        person: "User B",
        content:
          "Meeting completed. Action items: User C to finalize feature list, User D to prepare budget proposal.",
        time: "2024-12-26T15:00:00Z",
        platform: "Telegram",
        channel: "Product Planning",
      },
    ],
    expected: {
      insightCount: 1, // Should capture entire meeting lifecycle
      myTasksCount: 0, // Assuming User A is not involved
    },
  },
  {
    id: "insight-complex-05-parallel-work-streams",
    name: "Parallel Work Streams - Multiple Related Insights",
    description:
      "Parallel work streams on the same project should create separate but linked insights, not merge into one.",
    category: "A3",
    priority: "P1",
    userProfile: {
      name: "Alex Turner",
      email: "alex@software.io",
      role: "Tech Lead",
    },
    insights: [
      {
        taskLabel: "Frontend Development Progress",
        title: "Project Omega Frontend Development",
        description:
          "User B is working on Project Omega frontend development, currently implementing user interface components.",
        importance: "medium",
        urgency: "not_urgent",
        platform: "slack",
        account: "dev-team",
        groups: ["project-omega"],
        people: ["User B"],
        time: new Date("2024-12-26T09:00:00Z"),
        details: [
          {
            time: new Date("2024-12-26T09:00:00Z").getTime(),
            person: "User B",
            platform: "slack",
            channel: "project-omega",
            content:
              "Starting frontend work on Project Omega. Building the dashboard components.",
          },
          {
            time: new Date("2024-12-26T14:00:00Z").getTime(),
            person: "User B",
            platform: "slack",
            channel: "project-omega",
            content:
              "Dashboard UI is complete. Ready to integrate with backend.",
          },
        ],
      },
    ],
    messages: [
      {
        person: "User B",
        content:
          "Starting frontend work on Project Omega. Building the dashboard components.",
        time: "2024-12-26T09:00:00Z",
        platform: "Slack",
        channel: "project-omega",
      },
      {
        person: "User C",
        content:
          "I'm working on the backend API for Project Omega. Authentication endpoints are done.",
        time: "2024-12-26T09:05:00Z",
        platform: "Slack",
        channel: "project-omega",
      },
      {
        person: "User D",
        content:
          "Setting up the database schema for Project Omega. Users table is ready.",
        time: "2024-12-26T09:10:00Z",
        platform: "Slack",
        channel: "project-omega",
      },
      {
        person: "User B",
        content: "Dashboard UI is complete. Ready to integrate with backend.",
        time: "2024-12-26T14:00:00Z",
        platform: "Slack",
        channel: "project-omega",
      },
      {
        person: "User C",
        content: "All API endpoints ready for frontend integration.",
        time: "2024-12-26T14:30:00Z",
        platform: "Slack",
        channel: "project-omega",
      },
    ],
    expected: {
      insightCount: 3, // Should separate into 3 insights: frontend, backend, database
    },
  },
  {
    id: "insight-complex-06-feature-evolution",
    name: "Feature Evolution - From Idea to Implementation",
    description:
      "A feature that evolves from initial idea through requirements to implementation should be tracked in a single evolving insight.",
    category: "O2",
    priority: "P1",
    userProfile: {
      name: "Lisa Wang",
      email: "lisa@saas.co",
      role: "Product Manager",
    },
    insights: [
      {
        taskLabel: "New Feature Proposal",
        title: "User Dashboard Export Feature",
        description:
          "User B proposed adding a data export feature, the team is discussing its feasibility.",
        importance: "medium",
        urgency: "not_urgent",
        platform: "telegram",
        account: "product-team",
        groups: ["feature-requests"],
        people: ["User B"],
        time: new Date("2024-12-26T09:00:00Z"),
        details: [
          {
            time: new Date("2024-12-26T09:00:00Z").getTime(),
            person: "User B",
            platform: "telegram",
            channel: "feature-requests",
            content:
              "Customers are asking for a way to export their dashboard data. Should we add this feature?",
          },
          {
            time: new Date("2024-12-26T09:10:00Z").getTime(),
            person: "User C",
            platform: "telegram",
            channel: "feature-requests",
            content: "Yes, high demand. Need CSV and PDF export formats.",
          },
          {
            time: new Date("2024-12-26T09:20:00Z").getTime(),
            person: "User A",
            platform: "telegram",
            channel: "feature-requests",
            content: "Approved. Let's prioritize it for next sprint.",
          },
          {
            time: new Date("2024-12-26T14:00:00Z").getTime(),
            person: "User B",
            platform: "telegram",
            channel: "feature-requests",
            content: "Starting implementation. CSV export will be done first.",
          },
          {
            time: new Date("2024-12-27T10:00:00Z").getTime(),
            person: "User B",
            platform: "telegram",
            channel: "feature-requests",
            content: "Feature complete! Both CSV and PDF exports are now live.",
          },
        ],
      },
    ],
    messages: [
      {
        person: "User B",
        content:
          "Customers are asking for a way to export their dashboard data. Should we add this feature?",
        time: "2024-12-26T09:00:00Z",
        platform: "Telegram",
        channel: "feature-requests",
      },
      {
        person: "User C",
        content: "Yes, high demand. Need CSV and PDF export formats.",
        time: "2024-12-26T09:10:00Z",
        platform: "Telegram",
        channel: "feature-requests",
      },
      {
        person: "User A",
        content: "Approved. Let's prioritize it for next sprint.",
        time: "2024-12-26T09:20:00Z",
        platform: "Telegram",
        channel: "feature-requests",
      },
      {
        person: "User B",
        content: "Starting implementation. CSV export will be done first.",
        time: "2024-12-26T14:00:00Z",
        platform: "Telegram",
        channel: "feature-requests",
      },
      {
        person: "User B",
        content: "Feature complete! Both CSV and PDF exports are now live.",
        time: "2024-12-27T10:00:00Z",
        platform: "Telegram",
        channel: "feature-requests",
      },
    ],
    expected: {
      insightCount: 1, // Should track entire feature lifecycle
      myTasksCount: 0,
    },
  },
  {
    id: "insight-complex-07-hiring-process",
    name: "Hiring Process - From Requisition to Onboarding",
    description:
      "Complete hiring process from job posting to candidate selection should be tracked in one insight.",
    category: "O2",
    priority: "P1",
    userProfile: {
      name: "David Kim",
      email: "david@techcorp.com",
      role: "Engineering Manager",
    },
    insights: [
      {
        taskLabel: "Frontend Engineer Hiring",
        title: "Senior Frontend Engineer Position Open",
        description:
          "The team is hiring senior frontend engineers, User B is responsible for screening resumes.",
        importance: "medium",
        urgency: "24h",
        platform: "slack",
        account: "hiring-team",
        groups: ["hiring"],
        people: ["User B"],
        time: new Date("2024-12-26T09:00:00Z"),
        details: [
          {
            time: new Date("2024-12-26T09:00:00Z").getTime(),
            person: "User B",
            platform: "slack",
            channel: "hiring",
            content:
              "We need to hire a senior frontend engineer. I'll post the job today.",
          },
          {
            time: new Date("2024-12-26T14:00:00Z").getTime(),
            person: "User B",
            platform: "slack",
            channel: "hiring",
            content: "Job posted. Received 20 applications so far.",
          },
          {
            time: new Date("2024-12-27T10:00:00Z").getTime(),
            person: "User B",
            platform: "slack",
            channel: "hiring",
            content: "Screened 15 candidates. 5 selected for interviews.",
          },
          {
            time: new Date("2024-12-30T10:00:00Z").getTime(),
            person: "User B",
            platform: "slack",
            channel: "hiring",
            content:
              "Interviews complete. We're making an offer to our top candidate.",
          },
          {
            time: new Date("2024-12-31T10:00:00Z").getTime(),
            person: "User B",
            platform: "slack",
            channel: "hiring",
            content: "Candidate accepted! Onboarding starts next Monday.",
          },
        ],
      },
    ],
    messages: [
      {
        person: "User B",
        content:
          "We need to hire a senior frontend engineer. I'll post the job today.",
        time: "2024-12-26T09:00:00Z",
        platform: "Slack",
        channel: "hiring",
      },
      {
        person: "User B",
        content: "Job posted. Received 20 applications so far.",
        time: "2024-12-26T14:00:00Z",
        platform: "Slack",
        channel: "hiring",
      },
      {
        person: "User B",
        content: "Screened 15 candidates. 5 selected for interviews.",
        time: "2024-12-27T10:00:00Z",
        platform: "Slack",
        channel: "hiring",
      },
      {
        person: "User B",
        content:
          "Interviews complete. We're making an offer to our top candidate.",
        time: "2024-12-30T10:00:00Z",
        platform: "Slack",
        channel: "hiring",
      },
      {
        person: "User B",
        content: "Candidate accepted! Onboarding starts next Monday.",
        time: "2024-12-31T10:00:00Z",
        platform: "Slack",
        channel: "hiring",
      },
    ],
    expected: {
      insightCount: 1, // Should track entire hiring process
      waitingForOthersCount: 0,
    },
  },
  {
    id: "insight-complex-08-budget-approval",
    name: "Budget Approval - Multi-Level Approval Process",
    description:
      "Budget request that goes through multiple approval levels should update the same insight.",
    category: "O2",
    priority: "P1",
    userProfile: {
      name: "Rachel Green",
      email: "rachel@finance.co",
      role: "Finance Director",
    },
    insights: [
      {
        taskLabel: "Budget Approval",
        title: "Q1 Marketing Budget Request",
        description:
          "User B applied for $50,000 Q1 marketing budget, waiting for department supervisor approval.",
        importance: "high",
        urgency: "24h",
        platform: "telegram",
        account: "finance-team",
        groups: ["budget-approvals"],
        people: ["User B"],
        time: new Date("2024-12-26T09:00:00Z"),
        details: [
          {
            time: new Date("2024-12-26T09:00:00Z").getTime(),
            person: "User B",
            platform: "telegram",
            channel: "budget-approvals",
            content:
              "I need $50k for Q1 marketing campaigns. Submitting the budget request.",
          },
          {
            time: new Date("2024-12-26T14:00:00Z").getTime(),
            person: "User C",
            platform: "telegram",
            channel: "budget-approvals",
            content:
              "Request reviewed. Approved at department level. Forwarding to finance.",
          },
          {
            time: new Date("2024-12-26T18:00:00Z").getTime(),
            person: "User D",
            platform: "telegram",
            channel: "budget-approvals",
            content:
              "Finance review complete. Budget is within Q1 allocation. Final approval needed.",
          },
          {
            time: new Date("2024-12-27T09:00:00Z").getTime(),
            person: "User A",
            platform: "telegram",
            channel: "budget-approvals",
            content:
              "Budget approved for $50k. User B can proceed with marketing campaigns.",
          },
        ],
      },
    ],
    messages: [
      {
        person: "User B",
        content:
          "I need $50k for Q1 marketing campaigns. Submitting the budget request.",
        time: "2024-12-26T09:00:00Z",
        platform: "Telegram",
        channel: "budget-approvals",
      },
      {
        person: "User C",
        content:
          "Request reviewed. Approved at department level. Forwarding to finance.",
        time: "2024-12-26T14:00:00Z",
        platform: "Telegram",
        channel: "budget-approvals",
      },
      {
        person: "User D",
        content:
          "Finance review complete. Budget is within Q1 allocation. Final approval needed.",
        time: "2024-12-26T18:00:00Z",
        platform: "Telegram",
        channel: "budget-approvals",
      },
      {
        person: "User A",
        content:
          "Budget approved for $50k. User B can proceed with marketing campaigns.",
        time: "2024-12-27T09:00:00Z",
        platform: "Telegram",
        channel: "budget-approvals",
      },
    ],
    expected: {
      insightCount: 1, // Should track entire approval process
      myTasksCount: 1, // User A needs to provide final approval
    },
  },
  {
    id: "insight-complex-09-client-handover",
    name: "Client Handoff - Internal to External Communication",
    description:
      "Internal preparation for client meeting followed by actual client interaction should update the same insight.",
    category: "O2",
    priority: "P1",
    userProfile: {
      name: "Tom Hardy",
      email: "tom@agency.co",
      role: "Account Manager",
    },
    insights: [
      {
        taskLabel: "Client Meeting Preparation",
        title: "Client Acme Corp Quarterly Review Meeting",
        description:
          "The team is preparing for the Acme Corp quarterly review meeting, scheduled for tomorrow at 3 PM.",
        importance: "high",
        urgency: "24h",
        platform: "slack",
        account: "client-services",
        groups: ["acme-corp"],
        people: ["User B", "User C"],
        time: new Date("2024-12-26T09:00:00Z"),
        details: [
          {
            time: new Date("2024-12-26T09:00:00Z").getTime(),
            person: "User B",
            platform: "slack",
            channel: "acme-corp",
            content:
              "Preparing for the Acme Corp quarterly review meeting tomorrow at 3 PM.",
          },
          {
            time: new Date("2024-12-26T09:10:00Z").getTime(),
            person: "User C",
            platform: "slack",
            channel: "acme-corp",
            content: "I'll prepare the performance metrics slide deck.",
          },
          {
            time: new Date("2024-12-27T15:00:00Z").getTime(),
            person: "User B",
            platform: "slack",
            channel: "acme-corp",
            content: "Materials ready. Meeting with Acme Corp starting now.",
          },
          {
            time: new Date("2024-12-27T16:00:00Z").getTime(),
            person: "User B",
            platform: "slack",
            channel: "acme-corp",
            content:
              "Meeting completed. Client was satisfied with our performance. Contract renewal discussed.",
          },
          {
            time: new Date("2024-12-28T10:00:00Z").getTime(),
            person: "User B",
            platform: "slack",
            channel: "acme-corp",
            content:
              "Acme Corp decided to renew contract for another year. Negotiations starting next week.",
          },
        ],
      },
    ],
    messages: [
      {
        person: "User B",
        content:
          "Preparing for the Acme Corp quarterly review meeting tomorrow at 3 PM.",
        time: "2024-12-26T09:00:00Z",
        platform: "Slack",
        channel: "acme-corp",
      },
      {
        person: "User C",
        content: "I'll prepare the performance metrics slide deck.",
        time: "2024-12-26T09:10:00Z",
        platform: "Slack",
        channel: "acme-corp",
      },
      {
        person: "User B",
        content: "Materials ready. Meeting with Acme Corp starting now.",
        time: "2024-12-27T15:00:00Z",
        platform: "Slack",
        channel: "acme-corp",
      },
      {
        person: "User B",
        content:
          "Meeting completed. Client was satisfied with our performance. Contract renewal discussed.",
        time: "2024-12-27T16:00:00Z",
        platform: "Slack",
        channel: "acme-corp",
      },
      {
        person: "User B",
        content:
          "Acme Corp decided to renew contract for another year. Negotiations starting next week.",
        time: "2024-12-28T10:00:00Z",
        platform: "Slack",
        channel: "acme-corp",
      },
    ],
    expected: {
      insightCount: 1, // Should track from prep to outcome
      myTasksCount: 0,
    },
  },
  {
    id: "insight-complex-10-incident-postmortem",
    name: "Incident Postmortem - From Incident to Learning",
    description:
      "Complete incident lifecycle including postmortem and action items should be in one insight.",
    category: "O2",
    priority: "P1",
    userProfile: {
      name: "Chris Evans",
      email: "chris@reliability.co",
      role: "SRE Lead",
    },
    insights: [
      {
        taskLabel: "Production Incident Handling",
        title: "Database Service Outage Incident",
        description:
          "Production environment database service is down, User C is urgently fixing it.",
        importance: "high",
        urgency: "immediate",
        platform: "slack",
        account: "sre-team",
        groups: ["incidents"],
        people: ["User C"],
        time: new Date("2024-12-26T09:00:00Z"),
        details: [
          {
            time: new Date("2024-12-26T09:00:00Z").getTime(),
            person: "User B",
            platform: "slack",
            channel: "incidents",
            content: "🚨 Database service is down! All services are affected.",
          },
          {
            time: new Date("2024-12-26T09:05:00Z").getTime(),
            person: "User C",
            platform: "slack",
            channel: "incidents",
            content: "Investigating. Primary database node is unresponsive.",
          },
          {
            time: new Date("2024-12-26T09:10:00Z").getTime(),
            person: "User C",
            platform: "slack",
            channel: "incidents",
            content:
              "Failing over to standby node. Service should be back in 2 minutes.",
          },
          {
            time: new Date("2024-12-26T09:15:00Z").getTime(),
            person: "User C",
            platform: "slack",
            channel: "incidents",
            content: "Failover complete. Services are back to normal.",
          },
          {
            time: new Date("2024-12-26T14:00:00Z").getTime(),
            person: "User B",
            platform: "slack",
            channel: "incidents",
            content:
              "Postmortem meeting scheduled for tomorrow 10 AM. Root cause: network partition.",
          },
          {
            time: new Date("2024-12-27T11:00:00Z").getTime(),
            person: "User B",
            platform: "slack",
            channel: "incidents",
            content:
              "Postmortem complete. Action item: Improve network redundancy by end of Q1.",
          },
        ],
      },
    ],
    messages: [
      {
        person: "User B",
        content: "🚨 Database service is down! All services are affected.",
        time: "2024-12-26T09:00:00Z",
        platform: "Slack",
        channel: "incidents",
      },
      {
        person: "User C",
        content: "Investigating. Primary database node is unresponsive.",
        time: "2024-12-26T09:05:00Z",
        platform: "Slack",
        channel: "incidents",
      },
      {
        person: "User C",
        content:
          "Failing over to standby node. Service should be back in 2 minutes.",
        time: "2024-12-26T09:10:00Z",
        platform: "Slack",
        channel: "incidents",
      },
      {
        person: "User C",
        content: "Failover complete. Services are back to normal.",
        time: "2024-12-26T09:15:00Z",
        platform: "Slack",
        channel: "incidents",
      },
      {
        person: "User B",
        content:
          "Postmortem meeting scheduled for tomorrow 10 AM. Root cause: network partition.",
        time: "2024-12-26T14:00:00Z",
        platform: "Slack",
        channel: "incidents",
      },
      {
        person: "User B",
        content:
          "Postmortem complete. Action item: Improve network redundancy by end of Q1.",
        time: "2024-12-27T11:00:00Z",
        platform: "Slack",
        channel: "incidents",
      },
    ],
    expected: {
      insightCount: 1, // Should track entire incident lifecycle
    },
  },
  {
    id: "insight-complex-11-product-launch",
    name: "Product Launch - Pre-Launch to Post-Launch",
    description:
      "Product launch activities from preparation through execution to post-launch review should be tracked.",
    category: "O2",
    priority: "P1",
    userProfile: {
      name: "Jennifer Lee",
      email: "jennifer@product.co",
      role: "Product Marketing Manager",
    },
    insights: [
      {
        taskLabel: "Product Launch Preparation",
        title: "Mobile App V2.0 Release Plan",
        description:
          "Mobile App V2.0 is scheduled to release next Monday, the team is preparing launch materials.",
        importance: "high",
        urgency: "24h",
        platform: "telegram",
        account: "product-team",
        groups: ["product-launch"],
        people: ["User B", "User C", "User D"],
        time: new Date("2024-12-26T09:00:00Z"),
        details: [
          {
            time: new Date("2024-12-26T09:00:00Z").getTime(),
            person: "User B",
            platform: "telegram",
            channel: "product-launch",
            content:
              "Mobile App V2.0 launch scheduled for next Monday. Preparing announcement.",
          },
          {
            time: new Date("2024-12-26T14:00:00Z").getTime(),
            person: "User C",
            platform: "telegram",
            channel: "product-launch",
            content: "Press release ready. App Store submission complete.",
          },
          {
            time: new Date("2024-12-26T18:00:00Z").getTime(),
            person: "User D",
            platform: "telegram",
            channel: "product-launch",
            content:
              "Marketing materials prepared. Email campaign scheduled for Monday morning.",
          },
          {
            time: new Date("2024-12-30T09:00:00Z").getTime(),
            person: "User B",
            platform: "telegram",
            channel: "product-launch",
            content: "Launch day! App is now live on App Store and Play Store.",
          },
          {
            time: new Date("2024-12-31T09:00:00Z").getTime(),
            person: "User B",
            platform: "telegram",
            channel: "product-launch",
            content:
              "24 hours post-launch: 5,000 downloads, 4.5 star rating. Great start!",
          },
        ],
      },
    ],
    messages: [
      {
        person: "User B",
        content:
          "Mobile App V2.0 launch scheduled for next Monday. Preparing announcement.",
        time: "2024-12-26T09:00:00Z",
        platform: "Telegram",
        channel: "product-launch",
      },
      {
        person: "User C",
        content: "Press release ready. App Store submission complete.",
        time: "2024-12-26T14:00:00Z",
        platform: "Telegram",
        channel: "product-launch",
      },
      {
        person: "User D",
        content:
          "Marketing materials prepared. Email campaign scheduled for Monday morning.",
        time: "2024-12-26T18:00:00Z",
        platform: "Telegram",
        channel: "product-launch",
      },
      {
        person: "User B",
        content: "Launch day! App is now live on App Store and Play Store.",
        time: "2024-12-30T09:00:00Z",
        platform: "Telegram",
        channel: "product-launch",
      },
      {
        person: "User B",
        content:
          "24 hours post-launch: 5,000 downloads, 4.5 star rating. Great start!",
        time: "2024-12-31T09:00:00Z",
        platform: "Telegram",
        channel: "product-launch",
      },
    ],
    expected: {
      insightCount: 1, // Should track entire launch process
    },
  },
  {
    id: "insight-complex-12-partnership-deal",
    name: "Partnership Deal - Outreach to Signed Agreement",
    description:
      "Partnership deal from initial outreach through negotiation to signed agreement should be in one insight.",
    category: "O2",
    priority: "P1",
    userProfile: {
      name: "Mark Wilson",
      email: "mark@business.co",
      role: "Business Development",
    },
    insights: [
      {
        taskLabel: "Partnership Discussion",
        title: "Strategic Partnership Discussion with TechCorp",
        description:
          "Exploring strategic partnership opportunities with TechCorp, User B is in charge of outreach.",
        importance: "high",
        urgency: "24h",
        platform: "telegram",
        account: "bd-team",
        groups: ["partnerships"],
        people: ["User B"],
        time: new Date("2024-12-26T09:00:00Z"),
        details: [
          {
            time: new Date("2024-12-26T09:00:00Z").getTime(),
            person: "User B",
            platform: "telegram",
            channel: "partnerships",
            content:
              "Reaching out to TechCorp about potential strategic partnership.",
          },
          {
            time: new Date("2024-12-26T14:00:00Z").getTime(),
            person: "User B",
            platform: "telegram",
            channel: "partnerships",
            content:
              "TechCorp is interested. Initial meeting scheduled for Thursday.",
          },
          {
            time: new Date("2024-12-28T16:00:00Z").getTime(),
            person: "User B",
            platform: "telegram",
            channel: "partnerships",
            content:
              "Great meeting! They're open to revenue sharing model. Negotiating terms.",
          },
          {
            time: new Date("2024-12-30T10:00:00Z").getTime(),
            person: "User B",
            platform: "telegram",
            channel: "partnerships",
            content: "Terms agreed. Legal is drafting the agreement.",
          },
          {
            time: new Date("2025-01-02T10:00:00Z").getTime(),
            person: "User B",
            platform: "telegram",
            channel: "partnerships",
            content:
              "Partnership agreement signed with TechCorp! Launching joint initiatives next month.",
          },
        ],
      },
    ],
    messages: [
      {
        person: "User B",
        content:
          "Reaching out to TechCorp about potential strategic partnership.",
        time: "2024-12-26T09:00:00Z",
        platform: "Telegram",
        channel: "partnerships",
      },
      {
        person: "User B",
        content:
          "TechCorp is interested. Initial meeting scheduled for Thursday.",
        time: "2024-12-26T14:00:00Z",
        platform: "Telegram",
        channel: "partnerships",
      },
      {
        person: "User B",
        content:
          "Great meeting! They're open to revenue sharing model. Negotiating terms.",
        time: "2024-12-28T16:00:00Z",
        platform: "Telegram",
        channel: "partnerships",
      },
      {
        person: "User B",
        content: "Terms agreed. Legal is drafting the agreement.",
        time: "2024-12-30T10:00:00Z",
        platform: "Telegram",
        channel: "partnerships",
      },
      {
        person: "User B",
        content:
          "Partnership agreement signed with TechCorp! Launching joint initiatives next month.",
        time: "2025-01-02T10:00:00Z",
        platform: "Telegram",
        channel: "partnerships",
      },
    ],
    expected: {
      insightCount: 1, // Should track entire deal process
      waitingForOthersCount: 0,
    },
  },
  {
    id: "insight-complex-13-team-reorganization",
    name: "Team Reorganization - Proposal to Implementation",
    description:
      "Team restructuring from proposal through discussion to implementation should be tracked.",
    category: "O2",
    priority: "P1",
    userProfile: {
      name: "Sandra Martinez",
      email: "sandra@org.co",
      role: "VP Engineering",
    },
    insights: [
      {
        taskLabel: "Team Restructuring Plan",
        title: "Engineering Team Structure Reorganization Discussion",
        description:
          "Management is discussing reorganizing the engineering team, considering merging the platform and product groups.",
        importance: "high",
        urgency: "24h",
        platform: "slack",
        account: "leadership",
        groups: ["org-structure"],
        people: ["User B", "User C"],
        time: new Date("2024-12-26T09:00:00Z"),
        details: [
          {
            time: new Date("2024-12-26T09:00:00Z").getTime(),
            person: "User B",
            platform: "slack",
            channel: "leadership",
            content:
              "I think we should restructure the engineering team. Merge platform and product squads.",
          },
          {
            time: new Date("2024-12-26T09:10:00Z").getTime(),
            person: "User C",
            platform: "slack",
            channel: "leadership",
            content: "Could work. What's the rationale?",
          },
          {
            time: new Date("2024-12-26T09:15:00Z").getTime(),
            person: "User B",
            platform: "slack",
            channel: "leadership",
            content: "Better cross-functional collaboration and reduce silos.",
          },
          {
            time: new Date("2024-12-26T10:00:00Z").getTime(),
            person: "User D",
            platform: "slack",
            channel: "leadership",
            content: "I support this. Let's discuss in the all-hands meeting.",
          },
          {
            time: new Date("2024-12-27T14:00:00Z").getTime(),
            person: "User B",
            platform: "slack",
            channel: "leadership",
            content: "Team agrees on restructure. Effective from next month.",
          },
          {
            time: new Date("2025-01-02T09:00:00Z").getTime(),
            person: "User B",
            platform: "slack",
            channel: "leadership",
            content:
              "New team structure implemented. Teams have been reassigned.",
          },
        ],
      },
    ],
    messages: [
      {
        person: "User B",
        content:
          "I think we should restructure the engineering team. Merge platform and product squads.",
        time: "2024-12-26T09:00:00Z",
        platform: "Slack",
        channel: "leadership",
      },
      {
        person: "User C",
        content: "Could work. What's the rationale?",
        time: "2024-12-26T09:10:00Z",
        platform: "Slack",
        channel: "leadership",
      },
      {
        person: "User B",
        content: "Better cross-functional collaboration and reduce silos.",
        time: "2024-12-26T09:15:00Z",
        platform: "Slack",
        channel: "leadership",
      },
      {
        person: "User D",
        content: "I support this. Let's discuss in the all-hands meeting.",
        time: "2024-12-26T10:00:00Z",
        platform: "Slack",
        channel: "leadership",
      },
      {
        person: "User B",
        content: "Team agrees on restructure. Effective from next month.",
        time: "2024-12-27T14:00:00Z",
        platform: "Slack",
        channel: "leadership",
      },
      {
        person: "User B",
        content: "New team structure implemented. Teams have been reassigned.",
        time: "2025-01-02T09:00:00Z",
        platform: "Slack",
        channel: "leadership",
      },
    ],
    expected: {
      insightCount: 1, // Should track entire reorganization
    },
  },
  {
    id: "insight-complex-14-customer-resolution",
    name: "Customer Issue - From Complaint to Resolution",
    description:
      "Enterprise customer issue from complaint through investigation to resolution and follow-up.",
    category: "O2",
    priority: "P1",
    userProfile: {
      name: "Amanda White",
      email: "amanda@support.co",
      role: "Customer Success Manager",
    },
    insights: [
      {
        taskLabel: "Customer Complaint Handling",
        title: "Enterprise Client DeltaCorp Data Sync Issue",
        description:
          "DeltaCorp reported data sync delays, User C is investigating.",
        importance: "high",
        urgency: "immediate",
        platform: "slack",
        account: "cs-team",
        groups: ["enterprise-support"],
        people: ["User C"],
        time: new Date("2024-12-26T09:00:00Z"),
        details: [
          {
            time: new Date("2024-12-26T09:00:00Z").getTime(),
            person: "User B",
            platform: "slack",
            channel: "enterprise-support",
            content:
              "DeltaCorp is reporting data sync delays. Their dashboard shows stale data.",
          },
          {
            time: new Date("2024-12-26T09:10:00Z").getTime(),
            person: "User C",
            platform: "slack",
            channel: "enterprise-support",
            content:
              "On it. Checking the sync pipeline for DeltaCorp's instance.",
          },
          {
            time: new Date("2024-12-26T09:20:00Z").getTime(),
            person: "User C",
            platform: "slack",
            channel: "enterprise-support",
            content:
              "Found the issue. Data pipeline was throttled. Fixing now.",
          },
          {
            time: new Date("2024-12-26T09:45:00Z").getTime(),
            person: "User C",
            platform: "slack",
            channel: "enterprise-support",
            content:
              "Issue resolved. DeltaCorp's data is now syncing normally.",
          },
          {
            time: new Date("2024-12-27T10:00:00Z").getTime(),
            person: "User B",
            platform: "slack",
            channel: "enterprise-support",
            content:
              "Debriefed with DeltaCorp's CTO. They're satisfied. Committed to 99.9% uptime SLA going forward.",
          },
        ],
      },
    ],
    messages: [
      {
        person: "User B",
        content:
          "DeltaCorp is reporting data sync delays. Their dashboard shows stale data.",
        time: "2024-12-26T09:00:00Z",
        platform: "Slack",
        channel: "enterprise-support",
      },
      {
        person: "User C",
        content: "On it. Checking the sync pipeline for DeltaCorp's instance.",
        time: "2024-12-26T09:10:00Z",
        platform: "Slack",
        channel: "enterprise-support",
      },
      {
        person: "User C",
        content: "Found the issue. Data pipeline was throttled. Fixing now.",
        time: "2024-12-26T09:20:00Z",
        platform: "Slack",
        channel: "enterprise-support",
      },
      {
        person: "User C",
        content: "Issue resolved. DeltaCorp's data is now syncing normally.",
        time: "2024-12-26T09:45:00Z",
        platform: "Slack",
        channel: "enterprise-support",
      },
      {
        person: "User B",
        content:
          "Debriefed with DeltaCorp's CTO. They're satisfied. Committed to 99.9% uptime SLA going forward.",
        time: "2024-12-27T10:00:00Z",
        platform: "Slack",
        channel: "enterprise-support",
      },
    ],
    expected: {
      insightCount: 1, // Should track entire customer issue lifecycle
    },
  },
  {
    id: "insight-complex-15-quarterly-planning",
    name: "Quarterly Planning - From Kickoff to Final Plan",
    description:
      "Complete quarterly planning process from initial kickoff to finalized OKRs should be tracked.",
    category: "O2",
    priority: "P1",
    userProfile: {
      name: "Robert Taylor",
      email: "robert@strategy.co",
      role: "Head of Strategy",
    },
    insights: [
      {
        taskLabel: "Q2 Planning",
        title: "2025 Q2 Strategic Planning Kickoff",
        description:
          "Q2 strategic planning meeting has started, all departments are preparing goals and key results.",
        importance: "high",
        urgency: "24h",
        platform: "telegram",
        account: "strategy-team",
        groups: ["quarterly-planning"],
        people: ["User B", "User C", "User D"],
        time: new Date("2024-12-26T09:00:00Z"),
        details: [
          {
            time: new Date("2024-12-26T09:00:00Z").getTime(),
            person: "User B",
            platform: "telegram",
            channel: "quarterly-planning",
            content:
              "Kicking off Q2 2025 planning. All department heads to submit objectives by Friday.",
          },
          {
            time: new Date("2024-12-26T14:00:00Z").getTime(),
            person: "User C",
            platform: "telegram",
            channel: "quarterly-planning",
            content:
              "Engineering objectives: Launch AI features, improve performance 50%, hire 5 engineers.",
          },
          {
            time: new Date("2024-12-26T14:30:00Z").getTime(),
            person: "User D",
            platform: "telegram",
            channel: "quarterly-planning",
            content:
              "Sales objectives: $2M ARR, expand to EU market, hire 10 sales reps.",
          },
          {
            time: new Date("2024-12-27T10:00:00Z").getTime(),
            person: "User B",
            platform: "telegram",
            channel: "quarterly-planning",
            content:
              "Reviewing all department submissions. Some alignment needed.",
          },
          {
            time: new Date("2024-12-27T14:00:00Z").getTime(),
            person: "User B",
            platform: "telegram",
            channel: "quarterly-planning",
            content:
              "Alignment meeting scheduled for Thursday to resolve conflicts.",
          },
          {
            time: new Date("2024-12-30T16:00:00Z").getTime(),
            person: "User B",
            platform: "telegram",
            channel: "quarterly-planning",
            content: "Q2 2025 OKRs finalized. Total company goal: $10M ARR.",
          },
        ],
      },
    ],
    messages: [
      {
        person: "User B",
        content:
          "Kicking off Q2 2025 planning. All department heads to submit objectives by Friday.",
        time: "2024-12-26T09:00:00Z",
        platform: "Telegram",
        channel: "quarterly-planning",
      },
      {
        person: "User C",
        content:
          "Engineering objectives: Launch AI features, improve performance 50%, hire 5 engineers.",
        time: "2024-12-26T14:00:00Z",
        platform: "Telegram",
        channel: "quarterly-planning",
      },
      {
        person: "User D",
        content:
          "Sales objectives: $2M ARR, expand to EU market, hire 10 sales reps.",
        time: "2024-12-26T14:30:00Z",
        platform: "Telegram",
        channel: "quarterly-planning",
      },
      {
        person: "User B",
        content: "Reviewing all department submissions. Some alignment needed.",
        time: "2024-12-27T10:00:00Z",
        platform: "Telegram",
        channel: "quarterly-planning",
      },
      {
        person: "User B",
        content:
          "Alignment meeting scheduled for Thursday to resolve conflicts.",
        time: "2024-12-27T14:00:00Z",
        platform: "Telegram",
        channel: "quarterly-planning",
      },
      {
        person: "User B",
        content: "Q2 2025 OKRs finalized. Total company goal: $10M ARR.",
        time: "2024-12-30T16:00:00Z",
        platform: "Telegram",
        channel: "quarterly-planning",
      },
    ],
    expected: {
      insightCount: 1, // Should track entire planning process
    },
  },
  // ========== Partnership Promotion Request Tests ==========
  {
    id: "insight-promo-01-partnership-promotion-no-task",
    name: "Partnership Promotion Request - Should NOT Create My Task",
    description:
      "A partner requests help with promotion, but this is a general request to the group/channel, not a specific task assigned to the user. The system should NOT create myTasks for such promotional requests.",
    category: "K1",
    priority: "P0",
    userProfile: {
      name: "eee",
      email: "eee@ppp.io",
      role: "Channel Owner",
    },
    messages: [
      {
        person: "Partner Alice",
        content:
          "Our first batch 8 relics mint is now live. The WL mint round time will be 1 month: 23 Dec - 23 Jan. We don't want any WLs to miss the mint. For this first batch, there is no public round, only the WL round. Here is our announcement: https://example.com/announcement. Please kindly take a look and help us spread this. Thank you.",
        time: "2024-12-23T23:05:00Z",
        platform: "Telegram",
        channel: "ppp <> Partner",
      },
      {
        person: "Partner Alice",
        content: "eee @user_b, could you kindly check DM. Thank you.",
        time: "2024-12-24T02:50:00Z",
        platform: "Telegram",
        channel: "ppp <> Partner",
      },
    ],
    expected: {
      insightCount: 1, // Should create an insight about the promotion request
      myTasksCount: 0, // Should NOT create myTasks - this is a general promotion request, not a specific task assignment
      waitingForOthersCount: 0,
      urgency: "not_urgent", // Should be marked as not_urgent since it's a promotional request, not a blocking task
      importance: "medium", // Medium importance as it's partnership-related
    },
  },
  {
    id: "insight-promo-02-implicit-request-vs-direct-task",
    name: "Implicit Promotion Request vs Direct Task Assignment",
    description:
      "Distinguish between implicit requests (help spread the word) and direct task assignments. Implicit requests to 'help spread' should NOT create myTasks, while direct assignments should.",
    category: "K1",
    priority: "P0",
    userProfile: {
      name: "eee",
      email: "eee@ppp.io",
      role: "Channel Owner",
    },
    messages: [
      {
        person: "Partner Bob",
        content:
          "We're launching our NFT collection tomorrow. Could you please help us share the announcement with your community? Here's the link: https://example.com/nft-launch",
        time: "2024-12-26T09:00:00Z",
        platform: "Discord",
        channel: "partnership",
      },
      {
        person: "Project Manager",
        content:
          "@eee please write a tweet promoting Partner Bob's NFT launch and post it by EOD today.",
        time: "2024-12-26T09:30:00Z",
        platform: "Slack",
        channel: "marketing",
      },
    ],
    expected: {
      insightCount: 2, // Should separate into 2 insights: one for the general promotion request, one for the direct task
      myTasksCount: 1, // Only the direct task assignment should create myTasks
      waitingForOthersCount: 0,
    },
  },
  {
    id: "insight-promo-03-generic-help-request",
    name: "Generic 'Please Help' Requests - Should NOT Create Tasks",
    description:
      "Generic requests for help with promotion or sharing should NOT create myTasks unless there's a direct assignment with specific action items and deadlines.",
    category: "K1",
    priority: "P1",
    userProfile: {
      name: "eee",
      email: "eee@ppp.io",
      role: "Community Manager",
    },
    messages: [
      {
        person: "Partner Carol",
        content:
          "Hi team, our new project is launching next week. It would be great if you could help us spread the word! Check your DMs for more info.",
        time: "2024-12-26T10:00:00Z",
        platform: "Telegram",
        channel: "Partner Updates",
      },
      {
        person: "Partner Dave",
        content:
          "We'd really appreciate any support in sharing our announcement. No pressure, just if you can!",
        time: "2024-12-26T10:30:00Z",
        platform: "Telegram",
        channel: "Partner Updates",
      },
    ],
    expected: {
      insightCount: 2, // Should create insights about the promotion requests
      myTasksCount: 0, // Should NOT create myTasks - these are generic requests without specific assignments
      waitingForOthersCount: 0,
      urgency: "not_urgent",
    },
  },
  {
    id: "insight-promo-04-broadcast-mention-exclusion",
    name: "Broadcast with @Mention to Others - Should NOT Create Task",
    description:
      "When a message @mentions specific people (not including the user), it should NOT create myTasks for the user.",
    category: "K1",
    priority: "P1",
    userProfile: {
      name: "eee",
      email: "eee@ppp.io",
      role: "Community Manager",
    },
    messages: [
      {
        person: "Partner Eve",
        content:
          "Our mint is going live tomorrow! @user_b @user_c please help us promote this to your communities. Here's the announcement link.",
        time: "2024-12-26T11:00:00Z",
        platform: "Telegram",
        channel: "Partner Channel",
      },
    ],
    expected: {
      insightCount: 1, // Should create an insight
      myTasksCount: 0, // Should NOT create myTasks since eee is not mentioned
      waitingForOthersCount: 0,
    },
  },
  {
    id: "insight-promo-05-check-dm-not-for-me",
    name: "Check DM Request to Others - Should NOT Create Task",
    description:
      "When someone asks others to 'check DM', it should NOT create myTasks for the user unless the user is explicitly mentioned or addressed.",
    category: "K1",
    priority: "P1",
    userProfile: {
      name: "eee",
      email: "eee@ppp.io",
      role: "Community Manager",
    },
    messages: [
      {
        person: "Partner Frank",
        content:
          "We have some materials to share for our upcoming launch. @user_b @user_c could you kindly check DM? Thank you!",
        time: "2024-12-26T12:00:00Z",
        platform: "Telegram",
        channel: "Partner Channel",
      },
    ],
    expected: {
      insightCount: 1, // Should create an insight about the DM request
      myTasksCount: 0, // Should NOT create myTasks since eee is not addressed
      waitingForOthersCount: 0,
      urgency: "not_urgent",
    },
  },
];
