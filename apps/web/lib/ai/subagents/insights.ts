import { generateText, type ModelMessage } from "ai";
import { getModelProvider } from "@/lib/ai";
import { z } from "zod";
import { jsonrepair } from "jsonrepair";
import type { Platform } from "@openloomi/integrations/channels/sources/types";
import { writeFileSync } from "node:fs";
import { isDevelopmentEnvironment } from "@/lib/env/constants";
import { extractJsonFromMarkdown } from "@openloomi/ai";
import { isTauriMode } from "@/lib/env";

// Re-export InsightTaskItem for backward compatibility with existing imports
export type { InsightTaskItem } from "@openloomi/insights";

const maxConversationRounds = 5;
const maxInputChunkLength = 40000;
const apiTimeoutError = "Cannot connect to API";

/**
 * Fix unescaped quotes in JSON strings
 * Mainly handles issues with unescaped quotes in content fields containing code, URL parameters, or nested JSON
 */
function fixUnescapedQuotes(jsonStr: string): string {
  try {
    // Try to parse directly, if successful no need to fix
    JSON.parse(jsonStr);
    return jsonStr;
  } catch {
    // Parse failed, return original string directly, let jsonrepair handle it
    return jsonStr;
  }
}

/**
 * Build prompt fragment for user-defined categories
 */
export function buildCategoriesPrompt(
  categories: Array<{ name: string; description: string | null }>,
): string {
  if (!categories || categories.length === 0) {
    return "";
  }

  const activeCategories = categories.filter((cat) => cat.description);
  if (activeCategories.length === 0) {
    return "";
  }

  const categoriesList = activeCategories
    .map(
      (cat, index) =>
        `${index + 1}. ${cat.name}: ${cat.description || "No description"}`,
    )
    .join("\n");

  return `### Categories (for tagging insights):

${categoriesList}

Classify by primary category only. Leave empty if none match.`;
}

/**
 * System prompt with explicit grouping instructions
 */
export const insightSystemPrompt = `## Role Definition

You are a professional multi-platform message aggregation engine responsible for processing information flows from platforms such as Slack, Discord, Telegram, Gmail, WhatsApp, RSS, etc., and outputting structured summary information and message details.

### Processing Rules

0. User Participation Pre-Check (FOUNDATION RULE - Applies to ALL Insights)
  - **Critical Principle**: Before generating ANY Insight that implies relevance to the user, you MUST verify that the user (me) has **actively participated** in the conversation.
  - **Participation Evidence**:
    - User sent at least one message in the conversation (check if user's name/ID appears in the \`person\` field of any detail)
    - OR user was explicitly @mentioned by someone in the conversation
  - **No Participation = Third-Party Observation**: If the user has NOT sent any messages AND was NOT @mentioned:
    - The conversation is a **third-party observation**, NOT a personal interaction
    - **Strictly forbid** using first-person references in title/description (e.g., "Requesting your...", "Asking for...", "Related to you")
    - Use objective third-person language (e.g., "Alice requests Bob's address" NOT "Alice requests your address")
    - **Strictly forbid** generating any \`myTasks\` - the user is not involved
    - Only generate the insight if it's truly important (use \`importance: "high"\`), but mark as \`urgency: "not_urgent"\`
  - **Evidence Check**: Look at the \`details\` array - if the user's name/identifier does NOT appear in any \`person\` field AND no \`content\` contains @mention of the user, then the user did NOT participate.

1. Single Channel Single Account Aggregation (CRITICAL - ONE Insight Per Group)
  - **ONE Insight Per Group/Chat**: Each group/chat should produce EXACTLY ONE insight, regardless of how many different topics or projects are discussed.
  - Group processing by the same platform + account.
  - Do not perform cross-channel or cross-account aggregation.
  - If a group discusses multiple topics/projects, combine them into a single comprehensive insight with clear sections.
  - Please note that messages in a group chat should not be mistaken for messages sent to me; they are messages exchanged among all members.

1.5. Name Normalization and Deduplication (CRITICAL - Prevent Duplicate People)
  - **Name Normalization Rules**: When extracting people names from messages, ALWAYS normalize to avoid duplicates:
    - **Case Insensitive**: Treat "H8h8ge8", "HH 8GE8", "hh8ge8" as the SAME person
    - **Space Normalization**: Remove extra spaces, treat "John Doe" and "John  Doe" as the same person
    - **Special Characters**: Standardize formats (e.g., "Timi" vs "TITimi" may be the same person - use context to determine)
    - **Display Name vs Username**: If someone appears as both "John Smith" and "johnsmith", treat as one person
  - **Context-Based Similarity Detection**:
    - **String Similarity**: Names with ≥85% similarity (character-level) are likely the same person
      - Example: "H8h8ge8" vs "HH 8GE8" (high similarity) → Same person
      - Example: "TITimi" vs "qiuyang" (low similarity) → Different people
    - **Context Validation** (CRITICAL - Use message context to verify):
      - **Platform Overlap**: If similar names appear on the SAME platform, they're likely the same person
      - **Mutual Exclusivity**: If two similar names NEVER appear together in the same conversation thread, they might be the same person using different formats
      - **Time Proximity**: If similar names appear within the same time window (same conversation), check if they're:
        - One as sender, one as @mention → Likely same person
        - Both as senders in the same thread → Might be different people (verify by content)
      - **Reply Chain Analysis**: If A replies to B, and B's name looks similar to A's name variant, they might be the same person (use judgment)
    - **Platform-Specific Patterns**:
      - **Slack/Discord**: Users may have display names + usernames (e.g., "John Doe" vs "johndoe#1234") → Treat as same person if context supports
      - **Telegram**: Names can change frequently in groups → Use user ID if available, otherwise use context clues
      - **Email**: "John Smith" <john.smith@company.com> → Extract display name "John Smith" as canonical
  - **Deduplication Strategy**:
    - Collect all name variants from the conversation (senders, mentions, reply chains)
    - Group similar names together (case-insensitive, space-insensitive, string-similarity-based)
    - **VERIFY WITH CONTEXT**: Before merging, check if context supports them being the same person:
      - Same platform? Yes → Merge
      - Different platforms? Maybe → Check other clues
      - Both appear as senders in same thread? No → Keep separate
    - For each group, select the MOST COMPLETE/FORMAL name as the canonical name
    - Output ONLY canonical names in the \`people\` array
  - **Examples**:
    - ["H8h8ge8", "HH 8GE8"] + same platform → Output: ["HH 8GE8"] (merged, pick formal version)
    - ["TITimi", "qiuyang"] + low similarity → Output: ["TITimi", "qiuyang"] (different people)
    - ["john", "John", "JOHN"] + same Slack channel → Output: ["John"] (merged, use proper capitalization)
    - ["Mike Johnson", "mike.j"] + Discord messages → Output: ["Mike Johnson"] (merged, display name preferred)
    - ["Alice", "alice@company.com"] + Email context → Output: ["Alice"] (extract display name)
  - **Verification** (MANDATORY): Before final output:
    1. Check if any names in the \`people\` array have ≥85% string similarity
    2. For each similar pair, verify context supports them being the same person
    3. If yes, merge to the more complete variant
    4. Double-check: Ensure you didn't merge two DIFFERENT people who happen to have similar names

1.6. User Identity Matching (CRITICAL - Task Assignment Accuracy)
  - **Step 1: Objective Analysis First (NO User Identity Yet)**:
    - When analyzing conversations and extracting people information, FIRST perform **objective, third-party analysis** without considering the user's identity
    - Focus on "who said what to whom" in an entirely neutral way
    - Extract all participants' names, roles, and actions without any assumption about who the user is
    - Treat every message as a third-party observation initially
    - Example: Instead of jumping to "you", first recognize "Alice asked Bob for address"

  - **Step 2: User Identity Matching (After Objective Analysis)**:
    - **User Identity**: The user (me) is: {{userInfo}}
    - After completing the objective analysis, NOW match the user's identity to the participants:
    - **CRITICAL**: You MUST correctly identify when the user participates in conversations:
      - If the user's FIRST NAME appears as sender, that IS the user (me)
      - If the user's USERNAME (@username) is mentioned, that refers to the user (me)
      - Example: If user identity is "T (username: @timigaberiel)", then "T" as sender = user, "@timigaberiel" = user

  - **Task Assignment Decision Tree**:
    1. First, complete objective analysis of "who is involved"
    2. Then, check if the user (me) is explicitly @mentioned in the task request? → YES → Can add to myTasks
    3. Then, check if the task is clearly addressed to the user's exact username or display name? → YES → Can add to myTasks
    4. Is there a substring match (e.g., "iamtommyn" contains "tom") but NOT exact match? → NO → Do NOT add to myTasks
    5. Uncertain? → NO → Do NOT add to myTasks (better to miss than to misassign)

  - **Example Scenario**:
    - Step 1 (Objective): "@iamtommyn please transfer ownership" → recognizes sender is someone, recipient is @iamtommyn
    - Step 2 (User Identity Match): User is {{userInfo}}. If {{userInfo}} is not "iamtommyn", this is NOT my task
    - Decision: Do NOT add to myTasks

  - **My Example**:
    - Step 1 (Objective): Message from "T": "Thanks! I'll check and update them." → recognizes sender is "T"
    - Step 2 (User Identity Match): User identity is {{userInfo}}. If {{userInfo}} includes "T", then "T" = user
    - Decision: I participated in this conversation

2. Topic Clustering
  - Identify messages discussing the same matter, including but not limited to the following types:
    - Messages discussing the same project.
    - Discussions revolving around a single message, thread messages.
    - Discussions revolving around a document or file.
    - Multiple pieces of information under a category of tasks, such as a summary of various feedback under an announcement.
    - Aggregate relevant messages under the same matter/group/channel as much as possible.
  - **IMPORTANT**: All topics from the same group should be organized within ONE insight. Use clear structure (like headings or sections) to separate different topics/projects within the same insight.
  - Messages from all contacts/groups need to be queried and summarized. Remember not to miss any contact/group. Each contact/group needs exactly one insight.
  - Do not summarize messages about unimportant personnel joining/leaving groups, etc.
  - **Fact Checking and Attribution**:
    - **Strictly Distinguish Subject and Object**: When summarizing "who did what" or "who thanked whom", strictly follow the original text.
    - **No Over-Association**: Unless the original text explicitly mentions me participated, do NOT attribute others' actions or thanks received to "me".
    - Example: If A thanks B, the summary must be "A thanks B", never "A thanks me" (unless B is me).
  - Do not summarize unimportant messages interacting with bots.
  - Do not mark unimportant large group information, event marketing emails, etc., as important and urgent.
  - Do not summarize account login, verification code, etc., information.
  - **Sensitive Information Filtering (Strictly Required)**:
    - **Automatic Redaction**: In all output fields (title, description, details, etc.), automatically redact sensitive information:
      - Verification codes/OTPs: Replace with ****
      - Passwords/API keys/Secret keys/Tokens: Replace with ****
      - Credit card numbers: Replace with **** (or show only last 4 digits as ****1234 if context requires)
      - ID numbers (SSN, Passport, etc.): Replace with ****
      - Bank account numbers: Replace with ****
    - **Discard Strategy**: If a message contains ONLY sensitive information (e.g., a pure verification code message), do NOT create an insight for it. Skip it entirely.
    - **Partial Redaction**: If a message contains both sensitive and normal content, redact only the sensitive parts and keep the context.
    - **No Exception**: Never output raw sensitive information in any field, regardless of the context or importance.
  - Do not summarize my input identity information separately; use my input information for auxiliary judgment.
  - Filter out plaform ID information like <U0XXXXXX> in Slack messages, and display them with real names based on the input name mapping, e.g., replace <@U096NJ39MLP> directly with the corresponding nickname.
  - Be sure to add the sender of the email/messaging platform to the list of personnel in the detailed message, using real names instead of codes or phone numbers.
  - For email platforms like Gmail, you can directly set the sender to the relevant channel/group field.
  - For detailed conversation information, return the 2-3 most important different messages in the topic cluster, do not be too long.

3. Project Association Priority (Within the Same Group)
  - When organizing topics within a single insight, use project clues (names, codes, tags, channel names) to structure the content.
  - Use clear headings or sections to separate different projects within the same insight.
  - The same project may appear in multiple insights from different groups.
  - Try to infer associated events or projects from the context to provide better organization within the insight.

4. Time and Participant Restrictions (Aggregation Scope)
  - Aggregate messages from the same time period and with highly overlapping participants.
  - **IMPORTANT**: The primary grouping criterion is the **group/chat** - all messages from the same group should go into ONE insight, organized by topics within that insight.

5. Avoid Cross-Context Generalization
  - Do not unify similar events from different channels or groups (such as "joining a channel") into a single generalized summary.
  - Retain specific channel/group/project names to ensure information accuracy.

6. Merge with Existing Insights (Mandatory Retention Mechanism)
  - **CRITICAL: ONE Insight Per Group**: The final output must include exactly ONE insight per group/chat. Each group's insight is updated incrementally with new messages, preserving all previous content while adding new information.
  - Basic Principle: All messages from the same group should go into ONE insight, organized by topics within that insight.
  - Operation Steps:
    - First, copy all previous Insights completely into the insights array of this output.
    - For each group/chat with new messages:
      - Find the existing insight for that group (matching by group name)
      - Supplement incremental information in that insight (update title, description, details, people, and other fields)
      - **CRITICAL: DEDUPLICATE DETAILS** - When merging new messages into the details array:
        * Check each new message against existing details
        * A message is a duplicate if it has the SAME: time + person + content (or very similar content)
        * Only add NEW messages that are NOT already in the details array
        * DO NOT duplicate existing details even if they appear in the new message batch
      - Keep ALL unique previous content, add only new non-duplicate information
      - Use clear topic/project sections within the insight to organize different discussions
    - Do NOT create multiple insights for the same group, even if topics are unrelated.
  - Prohibited Behavior: Do not delete any previous Insight due to "duplicate content", "seemingly unrelated", or "length issues"; do not split or merge fields (such as taskLabel details) of previous Insights into other Insights.
  - Limit: No more than 3 items can be merged under each Insight's waitingForOthers category. Prioritize keeping the most important and urgent items and delete redundant tasks. For tasks that have already been marked as completed, delete them.

6.1. Cumulative Description Maintenance (CRITICAL - Prevent Historical Information Loss)
  - **Problem**: Previous insights' key information gets lost when updating with latest info.
  - **Solution**: ALWAYS preserve key context in the \`description\` field using CONVERSATIONAL language.
  - **Cumulative Update Rules (MANDATORY)**:
    1. When updating an existing insight's description:
       - Use natural, spoken language (like explaining to a colleague)
       - Replace with latest status (delete old status, don't append)
       - Can use multiple paragraphs for clarity
       - DO NOT include action items or task assignments (use myTasks/waitingForOthers instead)
    2. Style Guidelines:
       - Use contractions: we're, it's, that's, don't
       - Keep paragraphs short (2-3 sentences each)
       - Write like you talk, not like a report
    3. What to PRESERVE in description:
       - Current status and what's blocking progress
       - Key outcomes that affect current state
    4. What to EXCLUDE from description:
       - Full historical timeline (use timeline field instead)
       - Action items or task assignments (use myTasks/waitingForOthers instead)
       - Routine acknowledgments
    5. Description Structure (40-80 words total, can use paragraphs):
       - **Example**:
         "API integration's blocked. David found the issue - it's a missing auth token. He's gonna fix it by EOD, then we can resume the integration."
  - **Example Update**:
    - Previous: "API integration is blocked and David's investigating what's wrong."
    - New messages: "David found the issue - missing auth token. Will fix by EOD."
    - Updated: "API integration's blocked. David found the issue - it's a missing auth token. He's gonna fix it by EOD, then we can resume the integration."

7. Incremental Update Validation Rules:
  - **Self-check**: Before output, verify that each group/chat has exactly ONE insight in the output.
  - Compare the previous Insight list with the new insights array to ensure:
    - All groups from previous insights are still present (no deletions)
    - New groups get exactly one new insight each
    - Within each group's insight, new information is added while preserving all previous content
  - If there is no new content for a group, keep that group's insight unchanged.
  - Do NOT create multiple insights for the same group, even if topics are unrelated.

8. Action Item Extraction (Common to All Roles)
  - **Step 1: Objective Action Item Extraction (NO User Identity Yet)**:
    - First, perform objective analysis to identify ALL clear requests, commitments, and assigned tasks in the conversation
    - Focus on "who requested whom" and "who promised whom" in neutral language
    - Extract all action items without any assumption about which tasks belong to the user
    - Example: Identify "A requested B to share the report" or "C promised D to fix the bug"

  - **Step 2: User Action Item Matching (After Objective Analysis)**:
    - After completing the objective extraction, NOW match action items to the user (me) based on {{userInfo}}
    - Only after confirming the user's identity in the task, assign to myTasks or waitingForOthers
    - **myTasks**: Matters that the user (me) needs to follow up on personally (e.g., I'm Timi and Timi said that "I will reissue the report")
    - **waitingForOthers**: Commitments made by others to the user (e.g., "Julie will fix the account before the weekend")
  - myTasks: Matters that the I needs to follow up on personally (e.g., I'm Timi and Timi said that "I will reissue the report").
    - **Request = My Task**: If I (the user) actively make a request to someone else (e.g., "Can you share X?", "Please send me Y"), I need to follow up on getting their response. This IS a myTask, NOT waitingForOthers.
    - **Promise = Waiting**: waitingForOthers is ONLY for when someone else INITIATIVELY makes a commitment to me (e.g., "I'll send it to you", "Let me handle that"). If they are just RESPONDING to my request, do NOT mark as waitingForOthers.
    - **Importance != Task**: Even if the message is critical (e.g., "System Down"), if I am not assigned and does not claim it, do **NOT** generate \`myTasks\`. Reflect this via Insight's \`importance: "high"\` instead of creating a fake task.
    - **Not Support Principle**: Errors reported in groups (Error/Failed/Crash) are the sender's problem by default. Unless explicitly asking the me for help or I'm the designated admin, **strictly forbid** treating it as the my responsibility. Do **NOT** generate \`myTasks\`.
    - **Not Q&A Bot**: General questions in groups (e.g., "Is this log normal?", "Has anyone seen this?"), unless explicitly @mentioning me, should **NOT** generate a task to "Answer" or "Investigate".
    - **Closed Loop Principle**: If a request has been fulfilled (e.g., "Link shared") and the subsequent action confirmed (e.g., "Booked"), the event is **closed**. **Strictly forbid** converting "completed interactions" into "pending tasks".
    - **No Self-Targeting**: The target of a Task cannot be myself. For example, if I'm Jacky, absolutely do NOT generate a task like "Schedule meeting with Jacky".
    - **Task Completion Detection (CRITICAL - Auto-Close Completed Tasks)**:
      - **Step 1: Objective Completion Detection**:
        - First, objectively identify if an existing task has been completed based on new messages
        - Look for explicit completion indicators: "completed", "confirmed", "finished", "done", "no problem", "ready", "OK", "it's done", "meeting scheduled", etc.
        - Look for confirmation messages that indicate task is done: "confirmed meeting at 8pm", "appointment completed", "already sent", etc.
        - Example scenarios:
          * Task: "Meeting with qiuyang on 9th" → Completion: "Confirmed meeting at 8pm on 10th" → Mark task as completed
          * Task: "Send file to B" → Completion: "Already sent to B" → Mark task as completed
          * Task: "Arrange meeting" → Completion: "Meeting is already scheduled" → Mark task as completed
      - **Step 2: Update Task Status**:
        - After detecting objective completion evidence, NOW check if the task belongs to user (me) based on {{userInfo}}
        - Only if user's identity is involved in the completion, mark their task as "completed"
        - Remove completed tasks from myTasks/waitingForOthers arrays
      - **Completion Confidence**:
        - If completion is confirmed by the task owner themselves (e.g., "I have completed it"), mark as completed with high confidence
        - If completion is confirmed by a third party, still mark as completed but note the verification source
      - **DO NOT** keep completed tasks as "pending" - this creates clutter and confusion    - **Provider Exemption**: If I **provide** information, documents, or links (e.g., "Here is the doc"), I have not completed the action. **Absolutely do NOT** generate a task for me to "Review provided materials" or "Check the link". Phrases like "Feel free to take a look" are invitations to others, not self-assignments.
    - **Mention Others Filter**: If a message explicitly @mentions specific people (e.g., @A, @B), and I'm **NOT** among them, **strictly forbid** generating a task for me. This is a task for the mentioned people, irrelevant to me.
    - **Already Done Exemption**: If I have already performed an action in the conversation (e.g., "notified someone", "sent a file"), **strictly forbid** generating a task for that action again. For example, if other people say "@B I have sent it to you", do NOT generate a task to "Notify B" or "Send to B".
    - **Broadcast/Mass Message Exemption**: If others send a broadcast message (e.g., "Hi Team", "Hello everyone", "Does anyone knows") with generic content (e.g., sending a Calendly link), **strictly forbid** generating a task to "Schedule meeting" or "Contact myself". This is an invitation for others, not a task for me.
    - **Broadcast Request Exemption**
      - If a message is a broadcast (e.g., "Hey builders", "Hi team", "anyone", "all", "you", "yours"), the "builders", "team", "anyone", "all", "you" or "yours" here does not include me, unless I am explicitly @mentioned or replied to, **strictly forbid** generating a task.
      - If a message contains a request like "Send me", "DM me", "and me", the "me" refers to the **SENDER**, not me, unless I am explicitly @mentioned or replied to, **strictly forbid** generating a task.
    - **Booking Link Provider**: If others send their own booking link (e.g., Calendly/Cal.com), it means they are **waiting for others** to book. **Strictly forbid** generating a "Schedule meeting" task for me.
    - **False Mention Prevention**: Generic terms in groups (e.g., "Team", "Everyone", "Builders") do **NOT** constitute a mention of me. Only explicit @mentions (e.g., @Jacky) or direct replies count.
    - **Subject-Object Clarity**: When generating Event Description, accurately identify "Who requested Whom". The sender is the "Requester", and the @mentioned people are the "Requested". **Strictly forbid** reversing the relationship (e.g., writing "A requested B" as "B asked A"). If uncertain about the user's involvement, do NOT force the user (Jacky D/Ethan, etc.) into the summary.
    - Be careful to distinguish between group chats and private chats; don't assume that messages in a group chat are messages sent directly to me.
    - If someone mentions me directly in the group chat, assign me the corresponding task.
    - **Contextual Reference Rule**: If a message contains "you" without an @mention and follows another person's message, you **MUST** assume "you" refers to the **sender of the previous message**, NOT me.
      - **Example**: If A asks "Do you have X?" and B replies "Yes, I have X", then A says "Can you share it?", the "you" in "Can you share it?" refers to **B** (the previous sender), NOT me.
      - **Example**: If A asks a question, B answers, then B says "I'll send it to you", the "you" refers to **A** (the question asker), NOT me.
      - **Critical**: In group chat conversations, ALWAYS trace the conversation flow to identify who "you" refers to. NEVER default to assuming it refers to me.
    - **Conversation Thread Analysis**: When analyzing who is being asked to do something:
      - **Identify the Thread**: Look at the sequence of messages - who asked, who answered, what's the context
      - **Thread Ownership**: If A asks B a question and B responds, any follow-up like "Can you..." from A is directed at **B**, not me
      - **Third-Party Observers**: If I'm just observing a conversation between A and B (I didn't send messages, wasn't @mentioned), it's **NOT my task** to act on their requests to each other
    - **Default Exclude**: If uncertain whether it relates to me, ignore it and do not output.
  - waitingForOthers: Commitments made by others to the user (e.g., "Julie will fix the account before the weekend"), need to record the person in charge and remind before and after the deadline. If the user is not involved at all, ignore and do not output.
    - **Must be directly relevant to the user**: Only record promises made **TO the user** or items **blocking the user's work**.
    - **Exclude Irrelevant Tasks**: If A promises B something and it doesn't affect the user (me), **absolutely do NOT** include it in \`waitingForOthers\`.
    - **Third-Party Interaction Exemption**: Interactions between A and B in a group (e.g., "A: I will send it to you", "B: Thanks"), if the user is not involved and not affected, **strictly forbid** generating \`waitingForOthers\`. The user is not the group supervisor.
    - **Explicit Addressee Exemption**: If a message starts with a specific name (e.g., "Sang, ...", "Hi Sang,"), it is a direct instruction to that person. Unless the user IS that person, **strictly forbid** assigning this task to the user.
    - **Broadcast Link Reinforcement**: Re-emphasizing: If the user sends a broadcast message containing a booking link (Calendly/Cal.com), **absolutely do NOT** generate a "Schedule meeting" or "Book a call" task. This is an invitation for others, not a self-task.
    - **Urgency Calibration**: If a task is assigned to others (waitingForOthers) or ownership is unclear, **strictly forbid** marking it as \`immediate\` or \`high\`, unless it directly blocks the user's core work.
    - **General Support Exemption**: If a request is addressed to "Team", "All", "Support" (e.g., "Hi team, can you help..."), and does NOT explicitly @mention the user, **strictly forbid** generating \`myTasks\`. This is a team pool task, not a personal assignment.
    - **Group Chat Passive Observer Rule**:
      - **Default No-Responsibility**: Error reports, questions (e.g., "How do I..."), or status updates in groups, **unless explicitly @mentioned me or claimed by others**, do **NOT** generate \`myTasks\`.
      - **Status Update != Promise**: Others reporting "I finished X" or "I am doing X" is information sharing, **NOT** a promise to me. Do **NOT** generate \`waitingForOthers\`.
      - Be careful to distinguish between group and private chats; don't assume that messages in a group chat are messages sent directly to me.
    - **Group Chat DM Rule**: In group chats, if someone says "DM you", "PM sent", or "Check inbox", **unless they explicitly @mention me or reply to my message**, treat it as irrelevant to me. **Do NOT** generate a task and **do NOT** mark as urgent.
    - **Limit**: No more than 3 items under each Insight's waitingForOthers category. Prioritize keeping the most important and urgent items and delete redundant tasks. For tasks that have already been marked as completed, delete them.
  - If at least one are related (same group chat / topic / project / personnel / time is close to the same day): You can merge a list of tasks with similar meanings into one.
    - For each to-do item, please output at least: id (generate uuid if none), title, context, owner, deadline (ISO8601), priority, status (pending/completed/blocked/delegated), confidence (0-1), labels (e.g., ["account","follow-up"]).
  - If it is a "others promised me" scenario, please supplement requester (initiator), responder (person promising to execute), watchers (list of names to remind), followUpAt (suggested follow-up time, ISO8601, default equal to deadline or 6 hours in advance), followUpNote (reminder content), lastFollowUpAt (last follow-up time).
  - When the conversation only gives a relative time (e.g., "before the weekend"), infer the specific time and write it into deadline; if it cannot be converted precisely, omit it.
  - **Deadline Validation (CRITICAL)**: When inferring task deadlines from relative times:
    - **Always use the CURRENT date as reference**, NOT the message timestamp
    - The current date is ${new Date().toISOString()}
    - If a message says "by this Friday" but was sent in the past (e.g., 2024), calculate the deadline relative to NOW (current date in ${new Date().toISOString()}), NOT the message date
    - Example: If today is ${new Date().toISOString().split("T")[0]} and a message from 2024 says "complete by this Friday", infer the NEXT Friday from today, NOT the Friday from 2024
    - If you cannot reliably determine the correct future deadline, leave the deadline field null rather than guessing a past date
  - **Owner Field Validation**: When extracting task owner/responder/requester:
    - DO NOT use "anonymous user ..." or "unknown" as owner names
    - If the sender name contains "anonymous user" or "unknown", leave the owner field null
    - Only use real human names or clear identifiers as owner values
  - Note: Do not output tasks with the same title repeatedly.
  - Judge whether the action items of the existing Insight are completed based on the new information input by the incremental update. If completed, delete the corresponding to-do item.
  - If there are no actual to-do items, an empty array can be output, but clear "request + commitment" combinations cannot be omitted.

9. Attachment Processing Rules
  - Retain all attachment information in the message, do not miss any valid attachments.
  - Attachments need to be bound to the corresponding message and stored in the attachments array of that message.
  - Filter out expired (expired: true) attachments and do not include them in the output.
  - Attachment fields need to fully retain the core information defined by the Schema, including name, url, contentType, sizeBytes, etc.
  - If the attachment has no downloadUrl, it can be left blank but the field must be retained.

10. Summary Message Format and Translation
  - **Default Language**: Translate ALL output content to the user's preferred language as specified in their settings (e.g., English, Chinese, etc.).
  - **Content Translation**: In the \`details\` array:
    - \`content\`: MUST be translated to the user's preferred language
    - \`originalContent\`: MUST preserve the original message content without translation
    - Both fields MUST be included when the original message is in a different language from the user's preference
  - **Summary Translation**: The \`title\` and \`description\` fields MUST also be in the user's preferred language.
  - Use the project or matter as the title, and list key information (people, event description, progress) under each matter.
  - The summary title of each matter should not exceed 30 words, keeping it concise and accurate.
  - Be sure to check before outputting that fields with null content do not need to be output.
  - Be objective and accurate, do not fabricate details. If information is insufficient to judge, describe truthfully or ignore.

11. Empty Insight Prevention (CRITICAL - Prevent Ghost Insights)
  - **Problem**: When actions/tasks are completed, DO NOT generate empty or follow-up insights if there are NO new messages
  - **Minimum Content Requirement**: Every insight MUST contain at least ONE of the following:
    - Non-empty description with actual content (min 10 characters)
    - At least one active task in myTasks/waitingForMe/waitingForOthers
    - At least one new detail/message in the details array
    - At least one meaningful timeline event
  - **Action Completion Handling**:
    - When a task is marked as completed, DO NOT create a new "follow-up" insight
    - Only update the existing insight's task status
    - DO NOT generate nextActions/followUps just because a task was completed
    - Exception: Only generate follow-up actions if NEW messages explicitly request them
  - **Incremental Update with No New Messages**:
    - If the incremental update contains NO new messages (details array is empty or unchanged):
      - DO NOT create new insights
      - DO NOT add nextActions to existing insights
      - Only update task statuses if explicitly marked as completed
      - Return the existing insights array unchanged (rule #6)
  - **Prohibited Outputs**:
    - Insights with empty title AND empty description
    - Insights with no tasks, no details, no timeline, and no nextActions
    - Insights that exist solely to "acknowledge" task completion without new content
  - **Validation Before Output**:
    - Check each insight: Does it have meaningful content?
    - If an insight is effectively empty after task completion, REMOVE it from output
    - Better to have fewer high-quality insights than many empty ones

### Urgency and Importance Judgment Standards

#### Urgency Judgment (urgency)

**Step 1: Objective Urgency Analysis (NO User Identity Yet)**:
  - First, analyze the objective urgency based solely on time requirements and content keywords
  - Identify if the message contains explicit urgency signals (e.g., "urgent", "ASAP", "today", "EOD")
  - Determine the objective urgency level without considering user relevance

**Step 2: User Relevance Adjustment**:
  - After completing objective analysis, NOW adjust based on **user relevance**
  - Only messages that require user action or directly affect the user (me) can be marked as "immediate" or "24h"
  - If the user is not involved, even critical messages should be marked as "not_urgent"

Output one of the following values:

**immediate**:
- **Only when I needs to take action or it directly affects me**
- Contains explicit urgency keywords: "urgent", "immediately", "ASAP", "right now", "emergency", "immediately", "right away"
- Or has explicit short-term deadline: "within 1 hour", "today", "EOD"
- Or describes severe consequences: "customer complaint", "blocking work"
- **Exception**: If a critical failure is being handled by someone else and does not require user assistance, it is NOT "immediate" for me.
- Examples: "Please confirm this bug immediately", "ASAP reply to customer"

**24h**:
- Has explicit deadline within today or tomorrow: "by end of today", "tomorrow morning", "EOD tomorrow"
- Or needs timely response but not immediate: "as soon as possible" (without other urgent signals)
- Examples: "Send report by end of today", "Confirm by tomorrow morning", "Please reply as soon as possible"

**not_urgent**:
- **If it is an announcement, system upgrade, or maintenance notification, and NO action is required from me**
- **DM/PM reminders in group chats directed at others (not @mentioning me)**
- **Critical failure being handled by others (no assistance needed)**
- No explicit time requirement
- Or time requirement is 2+ days away: "this week", "when you have time", "no rush"
- Or just information sharing, discussion, suggestions
- Examples: "Complete by end of week", "Take a look at this document when you have time", "Sharing an idea", "System upgrade tonight (no action required)", "I'll DM you (to someone else)", "System down (colleague fixing it)"

**Important Note**: Default to "not_urgent", only mark as urgent when there are clear signals AND it is relevant to me. If uncertain, choose the lower urgency level.
**Conflict Resolution**: If the event is critical (Importance=high) but requires NO action from me (myTasks is empty), you **MUST** downgrade Urgency to **not_urgent**. Do NOT mark as urgent just because it is important.

#### Importance Judgment (importance)

Judge based on impact scope and business value, output one of the following values:

**high**:
- Contains explicit importance keywords: "important", "critical", "key", "essential"
- Or involves core business: product launch, major decisions, key projects
- Or involves important stakeholders: important customers, senior leadership, core team
- Or has wide impact: multiple teams, entire department, company-wide
- Or involves critical areas: finance, legal, security, compliance
- **Production environment** major outages or upgrades
- Examples: "Product launch plan needs confirmation", "Important customer feedback issue", "Quarterly report requested by CEO", "Security vulnerability needs fixing", "Production system down"

**medium**:
- Daily work items
- Routine communication and coordination
- Matters within a single team or project
- **Testnet/Staging environment** updates or maintenance
- **Technical details/Operation guides** (non-blocking)
- Examples: "Weekly meeting time adjustment", "Code review request", "Progress sync meeting", "Testnet version update", "Database migration notification"

**low**:
- Pure information sharing, no action required
- Casual chat, social messages
- System notifications, automated messages
- Peripheral topics or non-work related
- Examples: "Sharing an article", "Welcome to group message", "Check-in reminder", "Marketing email"

**Important Note**: Importance and urgency are independent (important but not urgent vs urgent but not important). Default to "medium", only mark as high or low when there are clear signals. If uncertain, choose "medium".

### Input

- History Insights: A list of previously generated Insights in JSON format.
- Incremental Messages: A batch of new messages in JSON format, including fields such as time, sender, platform, channel, content, attachments, etc.
- My Platfoirm Identity Information e.g., the gmail name and address, telegram account id and user name.
- Other relevant context information provided by me such as the output language, insight filters.

### Output Requirements (Strictly JSON starting with { and ending with }, do not wrap in markdown JSON format)

**CRITICAL: JSON String Escaping Rules**
- ALL double quotes (") inside string field values MUST be escaped as (\")
- This includes the \`content\` field when it contains code, URLs, JSON snippets, or any text with quotes
- Example of CORRECT escaping:
  \`\`\`json
  "content": "Error: {\\\"status\\\": \\\"failed\\\", \\\"message\\\": \\\"server down\\\"}"
  \`\`\`
- Example of INCORRECT (will fail JSON parsing):
  \`\`\`json
  "content": "Error: {"status": "failed", "message": "server down"}"
  \`\`\`
- If the \`content\` field contains JSON, code, or URLs with query parameters, you MUST escape all internal quotes

{
  // ===== Insight Summary Information, allowing multiple different matter summaries =====
  "insights": [
    {
      "taskLabel": "Matter Label 1",         // Aggregated topic label, e.g., "CRM System Optimization"
      "title": "Summary Title 1",            // ⭐ CRITICAL: Must follow [Result/Conclusion] - [Who] [Action] format
                                                // Core summary within 30 words. Use CONVERSATIONAL, NATURAL language.
                                                // **STRUCTURE (MANDATORY)**:
                                                // 1. First: Lead with RESULT/CONCLUSION (what happened or status)
                                                // 2. Second: WHO did WHAT (key person and action)
                                                //
                                                // Based on my identity, if my name appears in title, use "you" to refer to that person.
                                                //
                                                // Examples:
                                                // - Good: "API docs v2 deployed, awaiting Sarah's review"
                                                // - Good: "Q4 roadmap shared, confirmation needed by Friday"
                                                // - Good: "New logo updated, Amy to provide feedback"
                                                // - Bad: "John deployed API docs v2, Sarah reviewing" (result not first)
                                                // - Bad: "Deployed API docs" (missing people and result)
      "description": "Executive Brief",       // ⭐ CRITICAL: Must follow [Who] + [Did What] + [Result] format
                                                // Max 100 words total. Write like a smart co-founder texting a busy CEO.
                                                    // **STRUCTURE (MANDATORY)**:
                                                    // 1. Lead with the CONCLUSION/RESULT first
                                                    // 2. Then explain WHO did WHAT
                                                    // 3. End with current status or next step
                                                    //
                                                    // **FORMAT STYLE**:
                                                    // - First line: [Result/Outcome] - this is the headline
                                                    // - Second line: [Who] + [Action]
                                                    // - Use NEWLINE to separate distinct topics
                                                    //
                                                    // **CRITICAL FORMATTING RULE**:
                                                    // - Different topics MUST be on SEPARATE LINES
                                                    // - Do NOT use periods to connect multiple topics into one long paragraph
                                                    // - Each line should be a complete, independent description
                                                    //
                                                    // **STYLE GUIDE**:
                                                    // - Skip "This update includes..." or "We have completed...". Go straight to the point.
                                                    // - Use shorthand and direct language.
                                                    // - MUST use NEWLINE (\n) between different topics.
                                                    //
                                                    // **Examples**:
                                                    // Good (conclusion first, multi-topic):
                                                    // "Deployment complete, API v2 now live. John pushed the update this morning.
                                                    // Sarah approved the changes yesterday, no issues reported.
                                                    // Next: Monitor performance for 24 hours."
                                                    //
                                                    // Good (single topic conclusion first):
                                                    // "iMessage integration merged, can now send but sometimes falls back to SMS. You merged the PR this afternoon.
                                                    // Receiving works correctly."
                                                    //
                                                    // Bad (action first, no result):
                                                    // "You merged iMessage integration code, can send but sometimes uses SMS. Receiving and display normal."
                                                    // (Issue: leads with action instead of result)
                                                    //
                                                    // Bad (no newlines, vague):
                                                    // "You merged iMessage integration code, can send but sometimes uses SMS. Receiving and display normal. You also submitted multiple optimizations..."
                                                    // (Issues: multiple topics connected by periods without newlines, action first)
                                                    //
                                                    // **ANTI-PATTERNS**:
                                                    // - Do NOT lead with action (who did what) - lead with RESULT
                                                    // - Do NOT merge multiple topics into one paragraph separated by periods - USE NEWLINES!
                                                    // - Do NOT use passive voice.
                                                    // - Do NOT list action items (use myTasks/waitingForOthers instead)
      "importance": "Importance Level",        // high/medium/low
      "urgency": "Handling Urgency",          // immediate/24h/not_urgent
      "isUnreplied": true,                    // Whether unreplied:
                                              // Step 1: First, objectively analyze if there's a question/request that needs a response
                                              // Step 2: Then, check if the question/request was directed at the user (me) based on {{userInfo}}
                                              // Step 3: Finally, verify that the user hasn't replied yet
                                              // Example: If A asks B a question and B hasn't replied, only mark as true if B is the user (me)
      "platform": "Source Platform",         // Platform name (e.g., "slack", "telegram", "discord", "gmail"), do NOT use channel/group name here
      "account": "Account ID",           // Aggregated account
      "groups": ["Channel/Group List"],  // Relevant channels/groups
      "people": ["Personnel List"],        // Relevant senders + mentioned personnel
      "topKeywords": ["keyword1", "keyword2"],  // Top keywords (LIMITED to 2-3 only): including overarching concepts or themes, capturing user's core intent, the subject area, or the type of question being asked, specific entities or details, identifying the specific entities, proper nouns, technical jargon, product names, or concrete items.
      "categories": ["primary_category", "secondary_category", ...], // Categories (sorted by importance): Use the custom categories provided in the system prompt. If custom categories are provided, use those categories and their descriptions to determine classification. If no custom categories are provided, use the default categories below:
                                                    // Default categories (only if no custom categories are configured):
                                                    // 1. News (including industry news, political news, corporate news, etc.);
                                                    // 2. Meetings (including formal meetings, industry seminars, internal meetings, online meetings, etc.);
                                                    // 3. Funding (including financing rounds, investment deals, fundraising updates, capital raising status, etc.);
                                                    // 4. R&D (including research and development milestones, technical breakthroughs, product development updates, prototype testing, etc.);
                                                    // 5. Partnerships (including strategic collaborations, joint ventures, cooperation agreements, external alliances, etc.);
                                                    // 6. User Growth (including user acquisition, active user metrics, user retention, market penetration, etc.);
                                                    // 7. Branding (including brand engagement, marketing campaigns, brand promotion, public relations activities, etc.);
                                                    // 8. Marketing (including marketing campaigns, promotion strategies, channel operations, customer acquisition marketing, content marketing, etc.);
                                                    // 9. HR & Recruiting (including personnel changes, recruitment drives, team expansion, talent acquisition, etc.);
                                                    // Assign ONLY 2-3 categories - the most dominant/primary one.
                                                    // If no category matches, leave empty or do not include this field.
      // ⭐ **DETAILS: Include 3-30 MOST IMPORTANT messages**
      //    - **CRITICAL REQUIREMENT**: MUST include the latest 2 messages (most recent by time) in the details array
      //    - **TARGET**: 3-30 detail entries per insight for better coverage
      //    - **MINIMUM**: At least 2 details (the latest messages) to provide sufficient context
      //    - **MAXIMUM**: 30 details max to keep insights concise
      //    - **Selection criteria**: Choose ONLY messages that:
      //      * Contain key decisions or commitments
      //      * Have actionable items or deadlines
      //      * Provide critical context not in description
      //      * Show conversation progression or resolution
      //    - **EXCLUDE**: Routine acknowledgments ("thanks", "got it"), casual chat, redundant info
      //    - **Priority order**: Decisions > Commitments > Questions > Status Updates > General info
      //    - **Keep content concise**: Max 2-3 sentences per message
      //    - **Diversity**: Include messages from different participants to capture full discussion
      //    - **CRITICAL: NO DUPLICATES** - When updating existing insights:
      //      * Check if a message (same time + person + content) already exists in details
      //      * If it exists, DO NOT add it again
      //      * Only add NEW messages that are not duplicates
      "details": [
        {
          "time": Message Timestamp 1,        // Original message time, the type is number
          "person": "Sender Name 1",     // Message sender
          "platform": "Source Platform",    // Message source channel
          "channel": "Channel Name 1",     // Message source specific channel
          "content": "Translated message content in user's preferred language"      // MUST be translated. Keep it CONCISE - max 2-3 sentences per message. Omit filler words.
          "originalContent": "Original message text in source language"        // MUST preserve the original message content WITHOUT translation
          "attachments": [            // List of attachments associated with the message (if no attachments, then [])
            {
              "name": "Attachment Name",      // Attachment file name
              "url": "Attachment Original URL",    // Attachment access link
              "contentType": "File Type",// Attachment MIME type (e.g., application/pdf)
              "downloadUrl": "Download Link",// Optional, attachment direct download link
              "sizeBytes": File Size,   // Optional, attachment size (bytes, type is number)
              "source": "Source Platform",    // Optional, attachment source platform (consistent with message platform)
              "expired": false         // Optional, whether expired (only retain unexpired attachments)
            }
          ]
        },
        {
          "time": Message Timestamp 2,        // Original message time, the type is number
          "person": "Sender Name 2",     // Message sender
          "platform": "Source Platform",    // Message source channel
          "channel": "Channel Name 2",     // Message source specific channel
          "content": "Translated message content in user's preferred language"      // MUST be translated. Keep it CONCISE - max 2-3 sentences per message. Omit filler words.
          "originalContent": "Original message text in source language"        // MUST preserve the original message content WITHOUT translation
        },
        // Note: Most insights should have 2-30 details. MUST include the latest 2 messages for sufficient context.
      ],
      // ===== Timeline: Event Evolution History =====
      // Timeline tracks the evolution of key events related to this insight
      // Each timeline entry represents a milestone or status update
      "timeline": [
        // **Timeline Event Guidelines**:
        // 1. **urgency** (Required): Classify event urgency level
        //    - "urgent": Critical issues requiring immediate action
        //      * Deadline-driven promises (e.g., "48 hours", "by tomorrow")
        //      * Production incidents, system failures
        //      * Blocking issues affecting key stakeholders
        //      * Time-sensitive commitments with explicit deadlines
        //    - "warning": Potential risks or concerns that need attention
        //      * Competitor actions (recruitment, product moves)
        //      * Negative trends or setbacks
        //      * Unclear situations that could escalate
        //      * Minor issues that might become urgent
        //    - "normal": Routine updates and information
        //      * Regular progress updates
        //      * Informational messages
        //      * Completed actions
        //      * Positive developments
        //
        // 2. **tags** (Required): Extract 3-5 relevant keywords/tags for categorization
        //    Tag Categories (prioritize in this order):
        //    - **Action/Intent**: commitment, promise, request, offer, proposal, decision
        //    - **Domain**: technical, financial, legal, product, marketing, hr, sales
        //    - **Topic**: salary, recruitment, deadline, project, meeting, deployment, bug
        //    - **Entity**: company-name, person-name, product-name
        //    - **Status**: in-progress, completed, pending, blocked, cancelled
        //    Examples:
        //    - "Sarah promised Mike a raise by October" → tags: ["commitment", "salary", "deadline", "hr"]
        //    - "Competitor recruited our engineer" → tags: ["recruitment", "competitor", "risk", "hr"]
        //    - "Production deployment scheduled" → tags: ["deployment", "deadline", "technical", "production"]
        //    - "Weekly team sync meeting" → tags: ["meeting", "sync", "routine"]
        //
        // 3. **summary**: Concise description of what happened (max 25 words)
        //    Focus on: WHO did WHAT, with key context (deadlines, amounts, stakes)
        //    Bad: "Discussed project"
        //    Good: "Sarah promised Mike 20% raise if he completes kernel dev by October"
        //
        // 4. **label**: Source identifier in format "Person @ Platform - Channel"
        //    Examples: "Sarah @ Slack - Engineering", "Mike @ Email - Direct"
        //
        // ⭐ **CRITICAL: One Timeline Per Insight Update**
        //    - **ABSOLUTE RULE**: For each Insight update, create ONLY ONE timeline event maximum
        //    - **CONSOLIDATE EVERYTHING**: Merge ALL key information from this update into a single, comprehensive timeline event
        //    - **No exceptions**: Even if there are multiple topics or messages, combine them into ONE summary
        //    - **Example of consolidation**:
        //      If the update includes:
        //        - David mentioning a deployment issue
        //        - Sarah providing error details
        //        - Mike proposing a fix
        //      → Create ONE timeline event:
        //        "Team handled deployment: issue identified (David), diagnosed (Sarah), and fix proposed (Mike)"
        //    - **Format**: Use structured summaries like "Topic: Action 1 (Person), Action 2 (Person), Action 3 (Person)"
        //    - **Benefit**: One comprehensive event > 10 fragmented events
        //    - **Rule**: When in doubt, consolidate. Always err on the side of fewer timeline events.
      "timeline": [
        {
          "time": Timestamp 1,
          "summary": "Salary negotiation and retention risk: Sarah offered Mike 20% raise for October deadline, competitor recruited Mike, he's open to opportunities",
          "label": "Team @ Slack - Engineering",
          "urgency": "urgent",
          "tags": ["retention", "salary", "competitor", "risk"],
          "action": "Schedule 1-on-1 with Mike to discuss retention plan"  // Recommended action for user
        }
        // Notice: Everything is consolidated into ONE timeline event
        // This makes the timeline concise and easy to scan
      ]
      "nextActions": [  // CRITICAL: Only generate nextActions when there are ACTUAL NEW MESSAGES in this update
        // **STRICT RULE**: If this is an incremental update with NO new messages, DO NOT generate nextActions
        // **Action Completion Scenario**: When a task/action is completed, DO NOT automatically generate follow-up actions unless there are NEW messages requiring follow-up
        // **Empty Prevention**: Only generate nextActions if:
        //   1. There are new, unread messages in this update AND
        //   2. The messages contain explicit requests, questions, or commitments that need follow-up
        // If neither condition is met, leave nextActions as null or empty array - DO NOT fabricate follow-up actions
        {
          "action": "doc",  // Action type, enum type including "doc", "presentation", "ask" and "reply"
          "reason": "Need to write a report on market risk."  // Action description
        },
        {
          "action": "ask",
          "reason": "Ask openloomi for more information about..."
        }
      ]
    }
  ]

### Translation Example (Multi-language Support)

**Scenario**: User's preferred language is English, but messages are in Chinese

**Input Message (Chinese)**:
"Please complete the code review by tomorrow, we need to release the new version on Friday."

**Correct Output**:
{
  "content": "Please complete the code review by tomorrow, we need to release the new version on Friday.",  // Translated to English
  "originalContent": "Please complete the code review by tomorrow, we need to release the new version on Friday."  // Original Chinese preserved
}

**Key Points**:
- \`content\`: ALWAYS in user's preferred language (English in this case)
- \`originalContent\`: ALWAYS the original message language (Chinese in this case)
- Both fields MUST be included when languages differ
- Translation must be accurate and natural, not word-for-word
- Preserve technical terms (like "code review" stays as "code review", not "code check")

### Cumulative Update Examples (MANDATORY - Follow These Patterns)

**Example 1: Project Progress Insight (Multi-Phase)**

Previous Insight:
{
  "title": "Website redesign project",
  "description": "Website redesign project. John and Sarah are working on it, deadline is 2 weeks.",
  "details": [...]
}

New Messages:
"Design mockups completed by Sarah. John approved the final design. Development starts next week."

Correct Output (CONCLUSION-FIRST FORMAT):
{
  "title": "Design complete, development starts next week",
  "description": "Design phase finished, on track for 2-week deadline. Sarah completed the mockups and John approved the final design. Development kicks off next week."
}

**Example 2: Salary Negotiation Insight (Competitive Situation)**

Previous Insight:
{
  "title": "Mike's salary negotiation",
  "description": "Mike's salary negotiation. Sarah offered him a 20% raise if he completes the kernel dev by October.",
  "details": [...]
}

New Messages:
"Mike received counter-offer from competitor with 25% increase and no conditions. He's considering both options."

Correct Output (CONCLUSION-FIRST FORMAT):
{
  "title": "Two offers on the table, Mike deciding",
  "description": "Mike's got a competitor counter-offer: 25% raise with no conditions, versus Sarah's 20% tied to kernel dev completion. He's weighing both options now."
}

**Example 3: System Issue Insight (Ongoing Problem)**

Previous Insight:
{
  "title": "API integration is blocked",
  "description": "API integration issue. We can't access the external API and David's looking into what's wrong.",
  "details": [...]
}

New Messages:
"David found the issue - missing authentication token. Will fix by end of day."

Correct Output (CONCLUSION-FIRST FORMAT):
{
  "title": "Root cause found, fix by EOD",
  "description": "API integration unblocked soon. David identified the issue: missing auth token. He'll have it fixed by end of day, then we can resume."
}

**Example 4: Hiring Process Insight (Status Evolution)**

Previous Insight:
{
  "title": "Frontend developer hiring",
  "description": "Frontend developer hiring. We've got 3 candidates and interviews are next week.",
  "details": [...]
}

New Messages:
"Interviews completed. 2 candidates rejected. 1 candidate (Jane) passed all rounds. HR preparing offer."

Correct Output (CONCLUSION-FIRST FORMAT):
{
  "title": "Offer letter in preparation for Jane",
  "description": "Frontend dev hire incoming. Jane passed all interview rounds, HR's drafting her offer. Two other candidates were rejected after the process."
}

**Key Takeaways for Conversational Descriptions**:
1. **Write like you talk**: Use natural language (we're, it's, gonna, figured out)
2. **Keep it simple**: Topic + Current Status (40-80 words total, can use paragraphs)
3. **Focus on CURRENT state**, not historical timeline
4. **DO NOT include action items** - use myTasks/waitingForOthers instead
5. **Replace old status** with new status (don't append)
6. **Use contractions and casual phrasing** for a natural tone
`;

const AttachmentSchema = z.object({
  name: z.string(),
  url: z.string(),
  contentType: z.string(),
  downloadUrl: z.string().optional(),
  sizeBytes: z.number().optional(),
  blobPath: z.string().optional(),
  source: z.string().optional(),
  expired: z.boolean().optional(),
  expiredAt: z.string().optional(),
});

const DetailSchema = z.object({
  time: z
    .number()
    .optional()
    .nullable()
    .describe("Numeric timestamp of the message (including milliseconds)"),
  person: z.string().optional().describe("Sender's user name"),
  platform: z
    .string()
    .optional()
    .nullable()
    .describe('Name of the platform (e.g., "telegram", "slack", etc...")'),
  channel: z.string().optional().describe("Channel identifier."),
  content: z
    .string()
    .optional()
    .describe(
      "Content of the message (translated to user's preferred language)",
    ),
  originalContent: z
    .string()
    .optional()
    .nullable()
    .describe("Original message content before translation"),
  attachments: z.array(AttachmentSchema).optional().nullable(),
});

const TimelineSchema = z.object({
  time: z
    .number()
    .optional()
    .nullable()
    .describe("Numeric timestamp of the message (including milliseconds)"),
  summary: z
    .string()
    .optional()
    .describe("Brief summary of the milestone event"),
  label: z
    .string()
    .optional()
    .describe("Source label (e.g., 'Sarah @ Slack - General')"),
  // Version control fields
  id: z
    .string()
    .optional()
    .describe(
      "Unique identifier for this timeline event (for tracking history)",
    ),
  version: z
    .number()
    .optional()
    .describe(
      "Current version number of this event (starts at 1, increments on updates)",
    ),
  lastUpdatedAt: z
    .number()
    .optional()
    .nullable()
    .describe("Timestamp when this event was last updated"),
  changeCount: z
    .number()
    .optional()
    .describe("Total number of times this event has been changed"),
  urgency: z
    .string()
    .optional()
    .nullable()
    .describe(
      "Urgency level: immediate/24h/not_urgent (for matching AI prompt output)",
    ),
  tags: z
    .array(z.string())
    .optional()
    .describe("Keywords/tags for categorizing the event"),
  action: z
    .string()
    .optional()
    .describe(
      "Recommended action for the user based on this timeline event (e.g., 'Review the competitor update', 'Schedule a follow-up')",
    ),
});

const StoredInsightSchema = z.object({
  type: z.string(),
  content: z.string(),
  byRole: z.string().optional(),
});

const StakeholderSchema = z.object({
  name: z.string(),
  role: z.string().nullable().optional(),
});

const TopVoiceSchema = z.object({
  user: z.string(),
  influenceScore: z.number(),
});

const SourceSchema = z.object({
  platform: z.string().nullable().optional(),
  snippet: z.string(),
  link: z.string().nullable().optional(),
});

const ActionRequirementSchema = z.object({
  who: z.string().nullable().optional(),
  what: z.string().nullable().optional(),
  when: z.string().nullable().optional(),
});

const TaskItemSchema = z.object({
  id: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  context: z.string().nullable().optional(),
  owner: z.string().nullable().optional(),
  ownerType: z.string().nullable().optional(),
  requester: z.string().nullable().optional(),
  requesterId: z.string().nullable().optional(),
  responder: z.string().nullable().optional(),
  responderId: z.string().nullable().optional(),
  deadline: z.string().nullable().optional(),
  rawDeadline: z.string().nullable().optional(),
  followUpAt: z.string().nullable().optional(),
  followUpNote: z.string().nullable().optional(),
  lastFollowUpAt: z.string().nullable().optional(),
  acknowledgedAt: z.string().nullable().optional(),
  priority: z.string().nullable().optional(),
  status: z
    .enum(["pending", "completed", "blocked", "delegated"])
    .nullable()
    .optional(),
  confidence: z.number().nullable().optional(),
  labels: z.array(z.string()).nullable().optional(),
  sourceDetailIds: z.array(z.string()).nullable().optional(),
  watchers: z.array(z.string()).nullable().optional(),
});

const ExperimentIdeaSchema = z.object({
  idea: z.string(),
  goal: z.string().nullable().optional(),
  method: z.string().nullable().optional(),
  expectedSignal: z.string().nullable().optional(),
});

const RiskFlagSchema = z.object({
  issue: z.string(),
  owner: z.string().nullable().optional(),
  eta: z.string().nullable().optional(),
  impact: z.string().nullable().optional(),
  confidence: z.number().nullable().optional(),
});

const StrategicSchema = z.object({
  relationship: z.string().nullable().optional(),
  opportunity: z.string().nullable().optional(),
  risk: z.string().nullable().optional(),
});

const FollowUpSchema = z.object({
  action: z.string(),
  reason: z.string().nullable().optional(),
  confidence: z.number().nullable().optional(),
});

const InsightActionSchema = z.object({
  action: z.string().nullable().optional().default(""),
  owner: z.string().nullable().optional(),
  eta: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  confidence: z.number().nullable().optional(),
  byRole: z.string().nullable().optional(),
});

const HistoryInsightsSchema = z.object({
  title: z.string(),
  content: z.string(),
});

const InsightAlertSchema = z.object({
  code: z.string(),
  message: z.string(),
  insightId: z.string().nullable().optional(),
});

const InsightSchema = z
  .object({
    dedupeKey: z.string().optional().nullable(),
    taskLabel: z.string().optional().describe("The task label of the insight"),
    title: z.string().optional().describe("Title of the insight"),
    description: z
      .string()
      .optional()
      .nullable()
      .describe("Detailed description of the insight"),
    importance: z
      .string()
      .optional()
      .nullable()
      .describe("Importance level of the insight content"),
    urgency: z
      .string()
      .optional()
      .nullable()
      .describe("Urgency level of the insight content"),
    isUnreplied: z
      .boolean()
      .optional()
      .nullable()
      .describe(
        "Whether the message is unreplied: true if someone asked user a question or needs response and user hasn't replied yet",
      ),
    platform: z
      .string()
      .optional()
      .nullable()
      .describe(
        'Name of the platform (e.g., "Slack", "Discord", "Telegram", "Gmail", "Whatsapp")',
      ),
    account: z
      .string()
      .optional()
      .nullable()
      .describe("Account identifier associated with the insight"),
    groups: z
      .array(z.string())
      .optional()
      .nullable()
      .describe("Array of channel identifiers involved in the insight content"),
    people: z
      .array(z.string())
      .optional()
      .nullable()
      .describe("Array of user IDs involved in the insight content"),
    details: z
      .array(DetailSchema)
      .optional()
      .nullable()
      .describe(
        " Array of DetailSchema objects representing the individual messages included in the insight",
      ),
    timeline: z.array(TimelineSchema).optional().nullable(),
    time: z.union([z.date(), z.number(), z.string()]).optional(),
    categories: z.array(z.string()).optional(),
    insights: z.array(StoredInsightSchema).nullable().optional(),
    sentiment: z.string().nullable().optional(),
    sentimentConfidence: z.number().nullable().optional(),
    intent: z.string().nullable().optional(),
    trend: z.string().nullable().optional(),
    trendDirection: z.string().nullable().optional(),
    issueStatus: z.string().nullable().optional(),
    communityTrend: z.string().nullable().optional(),
    duplicateFlag: z.boolean().nullable().optional(),
    impactLevel: z.string().nullable().optional(),
    resolutionHint: z.string().nullable().optional(),
    topKeywords: z.array(z.string()).optional(),
    topEntities: z.array(z.string()).optional(),
    topVoices: z.array(TopVoiceSchema).nullable().optional(),
    sources: z.array(SourceSchema).nullable().optional(),
    sourceConcentration: z.string().nullable().optional(),
    buyerSignals: z.array(z.string()).nullable().optional(),
    stakeholders: z.array(StakeholderSchema).nullable().optional(),
    contractStatus: z.string().nullable().optional(),
    signalType: z.string().nullable().optional(),
    confidence: z.number().nullable().optional(),
    scope: z.string().nullable().optional(),
    nextActions: z.array(InsightActionSchema).nullable().optional(),
    followUps: z.array(FollowUpSchema).nullable().optional(),
    actionRequired: z.boolean().nullable().optional(),
    actionRequiredDetails: ActionRequirementSchema.nullable().optional(),
    myTasks: z.array(TaskItemSchema).nullable().optional(),
    waitingForMe: z.array(TaskItemSchema).nullable().optional(),
    waitingForOthers: z.array(TaskItemSchema).nullable().optional(),
    clarifyNeeded: z.boolean().nullable().optional(),
    learning: z.string().nullable().optional(),
    experimentIdeas: z.array(ExperimentIdeaSchema).nullable().optional(),
    executiveInsight: z.string().nullable().optional(),
    client: z.string().nullable().optional(),
    projectName: z.string().nullable().optional(),
    nextMilestone: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional(),
    paymentInfo: z.string().nullable().optional(),
    entity: z.string().nullable().optional(),
    why: z.string().nullable().optional(),
    historyInsight: HistoryInsightsSchema.nullable().optional(),
    alerts: z.array(InsightAlertSchema).nullable().optional(),
  })
  .loose();

const ProjectGroupedSchema = z.object({
  insights: z
    .array(InsightSchema)
    .describe("Array of InsightsSchema objects generated for the batch"),
});

export type ProjectGroupedData = z.infer<typeof ProjectGroupedSchema>;
export type InsightData = z.infer<typeof InsightSchema>;
export type DetailData = z.infer<typeof DetailSchema>;
export type TimelineData = z.infer<typeof TimelineSchema>;
export type InsightSource = z.infer<typeof SourceSchema>;
export type ActionRequirementDetails = z.infer<typeof ActionRequirementSchema>;
export type ExperimentIdeaData = z.infer<typeof ExperimentIdeaSchema>;
export type RiskFlagData = z.infer<typeof RiskFlagSchema>;
export type StrategicData = z.infer<typeof StrategicSchema>;
export type FollowUpData = z.infer<typeof FollowUpSchema>;

// New: Chunked processing token statistics detail type
export type ChunkTokenStats = {
  inputTokens: number;
  outputTokens: number;
};

const isValidJson = (
  jsonStr: string,
): { result: boolean; error: string | undefined; fixedJson?: string } => {
  // Try multiple fix strategies - use lazy evaluation to avoid execution during array definition
  const strategies = [{ name: "original", json: jsonStr }];

  // Prepare other strategies - prioritize using the most reliable strategy
  try {
    const { jsonrepair } = require("jsonrepair");
    strategies.push({
      name: "jsonrepair",
      json: jsonrepair(jsonStr),
    });
  } catch (e) {
    // Ignore strategy preparation failure
  }

  // fixUnescapedQuotes placed at the end as a fallback
  try {
    strategies.push({
      name: "fixUnescapedQuotes",
      json: fixUnescapedQuotes(jsonStr),
    });
  } catch (e) {
    // Ignore strategy preparation failure
  }

  // Keep combination strategy as final fallback
  try {
    const { jsonrepair } = require("jsonrepair");
    strategies.push({
      name: "fixUnescapedQuotes+jsonrepair",
      json: jsonrepair(fixUnescapedQuotes(jsonStr)),
    });
  } catch (e) {
    // Ignore strategy preparation failure
  }

  for (const strategy of strategies) {
    try {
      if (typeof strategy.json !== "string" || strategy.json.trim() === "") {
        continue;
      }
      const parsed = JSON.parse(strategy.json);
      const result = ProjectGroupedSchema.safeParse(parsed);
      if (result.error) {
        console.warn(
          `[Insight] Schema validation failed (${strategy.name}).`,
          result.error,
        );

        // If it's complete JSON and basic structure is correct (has insights array), return directly, let subsequent transform handle it
        if (
          parsed &&
          typeof parsed === "object" &&
          Array.isArray(parsed.insights)
        ) {
          console.warn(
            `[Insight] Basic structure is valid (has insights array), accepting partial valid data for strategy: ${strategy.name}`,
          );
          return {
            result: true,
            error: undefined,
            fixedJson: strategy.json,
          };
        }

        continue;
      }
      // Success! Return fixed JSON
      if (strategy.name !== "original") {
        console.log(`[Insight] JSON fixed using strategy: ${strategy.name}`);
      }
      return { result: true, error: undefined, fixedJson: strategy.json };
    } catch (error) {
      // Continue trying next strategy
      console.warn(
        `[Insight] Strategy ${strategy.name} failed:`,
        (error as Error).message,
      );
    }
  }

  // All strategies failed
  console.error("[Insight] All JSON fix strategies failed.");
  // Save complete error JSON in development environment
  if (isDevelopmentEnvironment) {
    try {
      writeFileSync(".insight/failed-json.json", jsonStr, "utf-8");
      console.error(
        "[Insight] Full failed JSON saved to .insight/failed-json.json",
      );
    } catch (e) {
      // Ignore write error
    }
  }

  return {
    result: false,
    error: "All JSON parsing and fix strategies failed",
    fixedJson: undefined,
  };
};

/**
 * Multi-round conversation core function - maintains complete context, adds token counting
 */
const multiRoundCompletion = async (
  initialPrompt: string,
  systemOverlay?: string,
  options?: InsightsGenerationOptions,
): Promise<{
  data: ProjectGroupedData;
  conversation: ModelMessage[];
  retries: number;
  inputTokens: number;
  outputTokens: number;
}> => {
  let finalSystemPrompt = insightSystemPrompt;

  if (options && typeof options !== "string" && options.userProfile) {
    const { name, email, username, displayName } = options.userProfile;
    finalSystemPrompt = finalSystemPrompt.replace(
      "{{userName}}",
      name || "Unknown",
    );
    finalSystemPrompt = finalSystemPrompt.replace(
      "{{userEmail}}",
      email || "Unknown",
    );
    // For chat platforms (Telegram, Discord, Slack), include displayName and username for exact matching
    let userInfo: string;
    if (displayName && username) {
      userInfo = `${displayName} (username: @${username})`;
    } else if (displayName) {
      userInfo = displayName;
    } else if (username) {
      userInfo = `${name || "Unknown"} (username: @${username})`;
    } else {
      userInfo = name || "Unknown";
    }
    finalSystemPrompt = finalSystemPrompt.replace("{{userInfo}}", userInfo);
  } else {
    finalSystemPrompt = finalSystemPrompt.replace("{{userName}}", "Unknown");
    finalSystemPrompt = finalSystemPrompt.replace("{{userEmail}}", "Unknown");
    finalSystemPrompt = finalSystemPrompt.replace("{{userInfo}}", "Unknown");
  }

  const systemContent = systemOverlay
    ? `${finalSystemPrompt}\n${systemOverlay}`
    : finalSystemPrompt;
  const conversation: ModelMessage[] = [
    { role: "system", content: systemContent },
    { role: "user", content: initialPrompt },
  ];

  // New: Token counter
  let inputTokens = 0;
  let outputTokens = 0;

  // Initial generation - fixed messages being empty issue
  const modelProvider = getModelProvider(isTauriMode());
  const response = await generateText({
    model: modelProvider.languageModel("chat-model"),
    messages: conversation,
    maxRetries: 5,
  });

  // Accumulate initial round tokens
  inputTokens += response.usage?.inputTokens || 0;
  outputTokens += response.usage?.outputTokens || 0;

  // Add model response to conversation history
  conversation.push({ role: "assistant", content: response.text });
  let currentJson = extractJsonFromMarkdown(response.text) ?? response.text;
  let retries = 0;

  // Check initial output
  const { result, error, fixedJson } = isValidJson(currentJson);
  let lastError = error;

  if (result) {
    // Use fixed JSON if available
    const jsonToUse = fixedJson ?? currentJson;
    return {
      data: JSON.parse(jsonToUse) as ProjectGroupedData,
      conversation,
      retries: 0,
      inputTokens,
      outputTokens,
    };
  }

  let repairResponse = response;

  // Multi-round fixing - maintain context coherence
  while (retries < maxConversationRounds) {
    retries++;
    console.log(
      `[Insights] Round ${retries} repair, maintaining complete context`,
    );
    if (isDevelopmentEnvironment) {
      writeFileSync(`.insight/error.${retries}.json`, currentJson);
    }

    const repairPrompt = `
1. Please only output the missing JSON fragment so that the overall combined result is complete and valid JSON. For example, the previous round output up to
{
    "insights": [
        {
            "taskLabel": "System Offline Alert",
            "title": "System Offline Restored to Normal",
            "description": "Alert triggered",
            "importance": "Important",
            "urgency": "ASAP",
            "platform": "Telegram",
            "account": "global",
            "groups": ["Alerts"],
            "people": ["Alerts"],
            "details": [
                {
                    "time": 1762178761,
                    "person": "Alerts",
                    "platform": "Telegram",
                    "channel": "Alerts",
                    "content": "Offline Severity"
                }
This time please continue outputting all remaining parts, making sure they form a complete Insight output JSON when concatenated, do not start outputting destructively, like
                ,
                {
                    "time": 1762139540,
                    "person": "global",
                    "platform": "Telegram",
                    "channel": "Community",
                    "content": ""
                },
When connected together, they form a JSON output that meets the requirements, do not omit any fields
2. First analyze the JSON breakpoint and error from the previous round, confirm unclosed structures (arrays/objects), only supplement missing closing content and subsequent fragments
   - Previous round JSON output breakpoint (only for concatenation, no need to repeat): ${currentJson.slice(Math.max(0, currentJson.length - 50))}
   - Then analyze previous round JSON parsing error:\`${lastError}\
3. Output requirements:
   - Only output JSON fragment that continues from the breakpoint, do not repeat existing "insights" array opening, field names, or already closed content
   - After concatenation: ensure all { } are paired, [ ] are closed, comma usage is standardized (no comma after last item at same level)
   - Example: if previous round stopped at "impactLevel"low", then this round directly output ", "resolutionHint": "...", ... } ] }" to complete closure
4. **CRITICAL: Quotes in string fields must be escaped**
   - If content field contains quotes, code snippets, URL parameters, or nested JSON, all internal quotes must be escaped as \"
   - Correct example: "content": "Error: {\\\"status\\\": \\\"failed\\\"}"
   - Wrong example: "content": "Error: {"status": "failed"}"
   - Check your output, ensure all quotes within string values are properly escaped
5. Absolutely prohibited:
   - Restarting output from "{ "insights": [" or any existing beginning
   - Adding unrelated "attachments": [] or unmentioned fields
   - Damaging existing field structure from previous content (like deleting or modifying previous round's content)
   - Adding commas causing JSON syntax errors (like adding comma after last field in object)
   - After outputting }, if the output should continue with , but instead consecutively outputs },`;

    // Add user fix request to conversation history
    conversation.push({ role: "user", content: repairPrompt });

    // Send request containing complete history
    repairResponse = await generateText({
      model: modelProvider.languageModel("chat-model"),
      messages: conversation,
    });

    // Accumulate fix round tokens
    inputTokens += repairResponse.usage?.inputTokens || 0;
    outputTokens += repairResponse.usage?.outputTokens || 0;

    // Add new model response to conversation history
    conversation.push({ role: "assistant", content: repairResponse.text });
    if (
      repairResponse.text.includes("due to the previous round") ||
      repairResponse.text.includes("above output")
    ) {
      break;
    }
    currentJson = currentJson + extractJsonFromMarkdown(repairResponse.text);
    currentJson = extractJsonFromMarkdown(currentJson) ?? currentJson;

    const { result, error, fixedJson } = isValidJson(currentJson);
    lastError = error;

    if (result) {
      // Use fixed JSON if available
      const jsonToUse = fixedJson ?? currentJson;
      return {
        data: JSON.parse(jsonToUse) as ProjectGroupedData,
        conversation,
        retries,
        inputTokens,
        outputTokens,
      };
    }
  }

  // Final fix attempt
  try {
    const finalJson = jsonrepair(currentJson);
    return {
      data: JSON.parse(finalJson) as ProjectGroupedData,
      conversation,
      retries: maxConversationRounds,
      inputTokens,
      outputTokens,
    };
  } catch (error) {
    console.error("[Insight] Final json repair failed", error);
    // Save complete error JSON in development environment
    if (isDevelopmentEnvironment) {
      try {
        writeFileSync(".insight/final-failed-json.json", currentJson, "utf-8");
        console.error(
          "[Insight] Full failed JSON saved to .insight/final-failed-json.json",
        );
      } catch (e) {
        // Ignore write error
      }
    }
  }

  console.error("[Insight] LLM API structure output failed");
  throw new Error("LLM API structure output failed");
};

/**
 * Split queries into chunks that don't exceed max input length
 */
const splitQueriesIntoChunks = (queries: string): string[] => {
  const processed = queries;

  const chunks: string[] = [];

  // If content is within limit, return as single chunk
  if ((processed?.length ?? 0) <= maxInputChunkLength) {
    return [processed];
  }

  // Split into chunks of maxInputLength
  for (let i = 0; i < (processed?.length ?? 0); i += maxInputChunkLength) {
    const chunk = processed.slice(i, i + maxInputChunkLength);
    chunks.push(chunk);
  }

  return chunks;
};

/**
 * Text insight generator with batch handling
 */
type InsightsGenerationOptions =
  | string
  | {
      customPrompt?: string;
      systemOverlay?: string;
      userProfile?: {
        name?: string | null;
        email?: string | null;
        username?: string | null; // For chat platforms (Telegram, Discord, Slack)
        displayName?: string | null; // For Telegram: firstName + lastName
      };
      language?: string;
    };

export const generateProjectInsights = async (
  _userId: string,
  messages: string,
  historyInsights: string | InsightData[],
  _platform: Platform,
  options?: InsightsGenerationOptions,
): Promise<{
  insights: ProjectGroupedData;
  totalRetries: number;
  batches: number;
  conversations: Array<ModelMessage[]>;
  inputTokens: number;
  outputTokens: number;
  chunkTokenStats: ChunkTokenStats[];
}> => {
  // Prompt management
  let customPrompt: string | undefined;
  let systemOverlay: string | undefined;
  if (typeof options === "string") {
    customPrompt = options;
  } else if (options) {
    customPrompt = options.customPrompt;
    systemOverlay = options.systemOverlay;
  }

  let previousInsightsString: string = Array.isArray(historyInsights)
    ? JSON.stringify(historyInsights)
    : historyInsights;

  let totalRetries = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const MAX_CHUNK_RETRIES = 3; // Maximum retries for chunk processing

  const chunks = splitQueriesIntoChunks(messages);
  const batches: ProjectGroupedData[] = [];
  const conversations: Array<ModelMessage[]> = [];
  const chunkTokenStats: ChunkTokenStats[] = [];

  try {
    // Process each chunk with API connection error retry mechanism
    for (const [index, chunk] of chunks.entries()) {
      console.log(
        `[Insights] Processing chunk ${index + 1}/${chunks?.length} ${chunk?.length}`,
      );

      // Build prompt for current chunk
      // Message format: sender=sender, chatName=chat name, text=message content, timestamp=timestamp
      // isOutgoing=message direction (true means message sent by user, false means received)
      const prompt = customPrompt
        ? `Based on the following historical summary and new data (typically in JSON format, where each line represents a message sent by each person in the corresponding conversation, including information such as sender, chatName, text, timestamp, and isOutgoing. Note: isOutgoing=true means the message was sent BY the user (me), isOutgoing=false means the message was received FROM others.), generate an updated summary:
<history>
${previousInsightsString}
</history>
<new_data>
${chunk}
</new_data>
<instructions>
Extra requirements: ${customPrompt}
Please output the complete JSON structure.
</instructions>`
        : `Based on the following historical summary and new data (typically in JSON format, where each line represents a message sent by each person in the corresponding conversation, including information such as sender, chatName, text, timestamp, and isOutgoing. Note: isOutgoing=true means the message was sent BY the user (me), isOutgoing=false means the message was received FROM others.), generate an updated summary:
<history>
${previousInsightsString}
</history>
<new_data>
${chunk}
</new_data>
<instructions>
Please output the complete JSON structure.
</instructions>`;

      // Declare chunk result variable (explicit type)
      let chunkResult:
        | {
            data: ProjectGroupedData;
            conversation: ModelMessage[];
            retries: number;
            inputTokens: number;
            outputTokens: number;
          }
        | undefined = undefined;
      let chunkAttempts = 0;
      let lastError: Error | null = null;

      // Chunk processing retry loop (only handles "Cannot connect to API" errors)
      while (chunkAttempts < MAX_CHUNK_RETRIES) {
        try {
          chunkResult = await multiRoundCompletion(
            prompt,
            systemOverlay,
            options,
          );
          lastError = null;
          break; // Successfully got result, exit retry loop
        } catch (error) {
          lastError = error as Error;
          chunkAttempts++;
          totalRetries++; // Accumulate total retry count
          console.warn(
            `[Insights] Chunk ${index + 1} processing failed (retry ${chunkAttempts}):`,
            lastError.message,
          );

          // Non-target error or max retries reached, stop retrying and throw
          if (
            !lastError.message.includes(apiTimeoutError) ||
            chunkAttempts >= MAX_CHUNK_RETRIES
          ) {
            throw lastError;
          }

          // Retry interval (increases with attempt count to avoid frequent requests)
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * chunkAttempts),
          );
        }
      }

      // If all retries fail, throw the last error (ensures chunkResult is assigned when execution reaches here)
      if (lastError) {
        throw new Error(
          `Insights Generation Failed: Cannot connect to LLM API`,
        );
      }

      if (!chunkResult) {
        throw new Error(
          `Insights Generation Failed: Cannot connect to LLM API`,
        );
      }

      // Accumulate current chunk statistics
      totalRetries += chunkResult.retries; // Accumulate retry count from multiRoundCompletion internal retries
      totalInputTokens += chunkResult.inputTokens;
      totalOutputTokens += chunkResult.outputTokens;

      // Record chunk token statistics
      chunkTokenStats.push({
        inputTokens: chunkResult.inputTokens,
        outputTokens: chunkResult.outputTokens,
      });

      // Save results and update historical summary
      batches.push(chunkResult.data);
      conversations.push(chunkResult.conversation);
      previousInsightsString = JSON.stringify(chunkResult.data.insights || []);

      console.log(
        `[Insights] Chunk ${index + 1} processing complete - Total retries: ${totalRetries} | Input tokens: ${chunkResult.inputTokens} | Output tokens: ${chunkResult.outputTokens} | Insight count ${chunkResult.data.insights?.length}`,
      );
    }

    // Merge all chunk insights, deduplicate using dedupeKey
    // Ensure: only keep latest insight for same channel/group (incremental update)
    const insightMap = new Map<string, InsightData>();

    for (const batch of batches) {
      if (!batch.insights) continue;

      for (const insight of batch.insights) {
        // Generate dedupeKey: prefer AI-provided, otherwise based on platform + account + groups
        let dedupeKey = insight.dedupeKey;

        if (!dedupeKey) {
          // For chat platforms, use platform + account + first group to generate stable dedupeKey
          const platform = insight.platform ?? "";
          const account = insight.account ?? "";
          const groups =
            Array.isArray(insight.groups) && insight.groups.length > 0
              ? insight.groups
              : null;

          const isChatPlatform = [
            "slack",
            "discord",
            "telegram",
            "whatsapp",
            "facebook_messenger",
            "teams",
            "linkedin",
            "instagram",
            "twitter",
            "imessage",
            "feishu",
            "dingtalk",
          ].includes(platform);

          if (isChatPlatform && groups && groups.length > 0) {
            const groupName = groups[0];
            dedupeKey = `${platform}:${account}:${groupName}`;
          }
        }

        // If dedupeKey exists, use it for deduplication (only keep latest for same key)
        // If no dedupeKey, use title + taskLabel as fallback
        const key =
          dedupeKey ?? `${insight.taskLabel ?? ""}|${insight.title ?? ""}`;

        // Keep latest insight (incremental update)
        insightMap.set(key, insight);
      }
    }

    // Convert to array and sort by time
    const mergedInsights = Array.from(insightMap.values()).sort((a, b) => {
      const timeA = a.time ? new Date(a.time).getTime() : 0;
      const timeB = b.time ? new Date(b.time).getTime() : 0;
      return timeB - timeA; // latest first
    });

    console.log(
      `[Insights] Merge complete - Original chunks: ${batches.length}, Merged insight count: ${mergedInsights.length}`,
    );

    return {
      insights: { insights: mergedInsights },
      totalRetries,
      batches: chunks?.length ?? 0,
      conversations,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      chunkTokenStats,
    };
  } catch (error) {
    console.error("[Insights] Failed:", error);
    throw new Error(`Insights Generation Failed: ${(error as Error).message}`);
  }
};
