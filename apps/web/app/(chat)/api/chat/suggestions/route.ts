import { auth } from "@/app/(auth)/auth";
import { AppError } from "@openloomi/shared/errors";
import { generateText } from "ai";
import { getModelProvider } from "@/lib/ai";
import { setAIUserContextFromRequest } from "@/lib/ai/request-context";
import { z } from "zod";
import {
  getBotsByUserId,
  getUserRoles,
  getLatestSurveyByUserId,
  getUserInsightSettings,
  getStoredInsightsByBotIds,
} from "@/lib/db/queries";
import type { Insight } from "@/lib/db/schema";
import { insightIsUrgent } from "@/lib/insights/focus-classifier";
import { isTauriMode } from "@/lib/env";

/**
 * Response structure for suggested conversations
 */
const SuggestedPromptSchema = z.object({
  id: z.string(),
  title: z.string(),
  emoji: z.string(),
  type: z.enum(["event_based", "pattern_based", "role_based"]),
  reasoning: z.string(),
  related_insight_ids: z.array(z.string()),
});

const SuggestionsResponseSchema = z.object({
  suggested_prompts: z.array(SuggestedPromptSchema).length(3),
});

/**
 * Extract categories from Insight
 * Prioritize the categories field, otherwise extract from the insights field
 */
function extractCategories(insight: Insight): string[] {
  // Prioritize the categories field in schema
  if (insight.categories && Array.isArray(insight.categories)) {
    return insight.categories.filter(
      (cat): cat is string => typeof cat === "string" && cat.length > 0,
    );
  }
  // If no categories field exists, extract from the insights field
  if (insight.insights && Array.isArray(insight.insights)) {
    return insight.insights
      .map((item) => item.category)
      .filter(
        (cat): cat is string => typeof cat === "string" && cat.length > 0,
      );
  }
  return [];
}

/**
 * Check if event is from today
 */
function isTodayEvent(time: Date | string, currentDate: string): boolean {
  const eventDate = typeof time === "string" ? new Date(time) : time;
  const eventDateStr = eventDate.toISOString().split("T")[0];
  return eventDateStr === currentDate;
}

/**
 * Check if event is high priority
 */
function isHighPriorityEvent(insight: Insight): boolean {
  const categories = extractCategories(insight);
  const hasImportantCategory = categories.some((cat) =>
    ["opportunity", "risk", "decision"].includes(cat),
  );
  return (
    insightIsUrgent(insight) ||
    insight.importance === "high" ||
    hasImportantCategory
  );
}

/**
 * Format Insight data for API requirements
 */
function formatInsightForAPI(insight: Insight): {
  id: string;
  title: string;
  description: string;
  taskLabel: string;
  importance: string;
  urgency: string;
  platform: string | null;
  account: string | null;
  people: string[];
  groups: string[];
  time: string;
  categories: string[];
  isUnreplied: boolean;
  actionRequired: boolean;
  sentiment: string | null;
  intent: string | null;
  trend: string | null;
} {
  return {
    id: insight.id,
    title: insight.title,
    description: insight.description,
    taskLabel: insight.taskLabel,
    importance: insight.importance,
    urgency: insight.urgency,
    platform: insight.platform ?? null,
    account: insight.account ?? null,
    people: Array.isArray(insight.people) ? insight.people : [],
    groups: Array.isArray(insight.groups) ? insight.groups : [],
    time:
      insight.time instanceof Date
        ? insight.time.toISOString()
        : typeof insight.time === "string"
          ? insight.time
          : new Date().toISOString(),
    categories: extractCategories(insight),
    isUnreplied: insight.isUnreplied ?? false,
    actionRequired: insight.actionRequired ?? false,
    sentiment: insight.sentiment ?? null,
    intent: insight.intent ?? null,
    trend: insight.trend ?? null,
  };
}

/**
 * Get user's insights from the past 24 hours
 */
async function getLast24HoursInsights(userId: string): Promise<Insight[]> {
  const bots = await getBotsByUserId({
    id: userId,
    limit: null,
    startingAfter: null,
    endingBefore: null,
    onlyEnable: false,
  });

  if (bots.bots.length === 0) {
    return [];
  }

  const botIds = bots.bots.map((bot) => bot.id);
  // Get insights from the past 1 day (24 hours)
  const { insights } = await getStoredInsightsByBotIds({
    ids: botIds,
    days: 1,
  });

  return insights;
}

/**
 * Build system prompt (based on Dialogue-Suggestion.md)
 */
function buildSystemPrompt(): string {
  return `# openloomi Intelligent Recommended Conversation Generation System Prompt

> **Version**: 1.0
> **Goal**: Generate 3 highly personalized, immediately usable recommended conversations for openloomi users, helping users gain insights from historical data rather than executing specific actions.

---

## System Role Definition

You are openloomi's **Intelligent Conversation Recommendation Engine**, specifically designed to generate personalized exploratory questions for users. Your responsibilities are:

1. **Based on user context** (role, industry, work description, focus topics, Insight events) generate 3 recommended conversations
2. **Prioritize today's relevance**: If there are Insight events today, prioritize generating questions around today's events
3. **Value user preferences**: Prioritize user manually selected roles (\`source: "profile"\`) and focus topics (\`focusTopics\`)
4. **Moderate guidance + open-ended discovery**: Questions should help users discover patterns, trends, and key signals, rather than specific execution actions
5. **Avoid hallucinations**: Only generate questions based on provided real data, do not speculate non-existent information
6. **Natural and concise**: Each recommendation should not exceed 15 characters, maintaining a conversational tone

---

## Generation Rules

### Rule 1: Priority Allocation (Based on Data Availability)

- **Scenario A: Today has Insight events**
  - **2 recommendations** around today's high-priority events (\`urgency="urgent"\` or \`importance="high"\` or \`categories\` containing "opportunity"/"risk"/"decision")
  - **1 recommendation** based on user's other event insights (if other today or historical events exist, prioritize generating based on these events; otherwise based on role/industry/focus topics)

- **Scenario B: No Insight today, but has historical events**
  - **2 recommendations** based on recent historical event pattern analysis (e.g., "What topics were repeatedly mentioned this week?")
  - **1 recommendation** based on user's other event insights (if other historical events exist, prioritize generating based on these events; otherwise based on role/industry/focus topics)

- **Scenario C: No any Insight events (new user)**
  - **3 recommendations** all based on role/industry/focus topics to generate high-value exploratory questions

### Rule 2: Question Type Distribution

Each recommendation must belong to one of three types:

1. **Event-Driven** (Event-Based)
   - Generated based on specific Insight, helping users understand "what happened"
   - Examples: \`"What is Customer A's core request?"\`, \`"What are the main risks discussed by the team today?"\`

2. **Pattern Discovery** (Pattern-Based)
   - Based on historical data aggregation, helping users discover trends
   - Examples: \`"Which customers were most active this week?"\`, \`"What recurring issues have appeared recently?"\`

3. **Role-Customized** (Role-Based)
   - Generate high-frequency scenario questions based on user role/industry/work description/focus topics
   - Prioritize user manually selected roles (\`source: "profile"\`) and focus topics (\`focusTopics\`)
   - Example (Sales role + Focus topic "Customer Relationships"): \`"What topics are my potential customers recently focused on?"\`
   - Example (Product Manager role + Focus topic "User Feedback"): \`"What common pain points are in the user feedback?"\`

### Rule 3: Prohibition List

❌ **Do NOT generate execution-type questions**:
- Wrong example: "Help me reply to Zhang San's message", "Schedule tomorrow's meeting"
- Correct example: "What is Zhang San's biggest concern?"

❌ **Do NOT speculate non-existent information**:
- If "Customer B" is not in the Insight, do not mention Customer B
- If user's industry is "Finance", do not assume they are working on "payment products"

❌ **Do NOT be overly specific**:
- Wrong example: "What did the message at 14:32 in Slack channel #sales say?"
- Correct example: "What key topics were discussed in the sales channel today?"

---

## Output Format

Return strict JSON format without any Markdown code block markers:

\`\`\`json
{
  "suggested_prompts": [
    {
      "id": "string",             // Unique identifier, e.g., "suggest_001" or generated based on insight_id
      "title": "string",          // Recommended conversation text (≤15 chars), will be sent as user message after click
      "emoji": "string",          // Emoji icon, choose appropriate emoji based on type and content
      "type": "string",           // Type: "event_based" | "pattern_based" | "role_based" (metadata, for logging)
      "reasoning": "string",      // Generation reason (internal log use, not shown to user)
      "related_insight_ids": ["string"] // Related Insight IDs (if any, metadata)
    }
  ]
}
\`\`\`

### Emoji Selection Guide

Choose appropriate emoji based on recommendation type and content:

- **Event-Driven (event_based)**:
  - Opportunity related: 💰、🎯、💼
  - Risk related: ⚠️、🚨、🔔
  - Decision related: 📋、💡、🎯
  - Customer inquiry: 💬、📧、👥
  - Team discussion: 💭、🗣️、👥

- **Pattern Discovery (pattern_based)**:
  - Trend analysis: 📈、📊、🔍
  - Recurring issues: 🔄、⚠️、❓
  - Activity level: 🔥、⚡、📢

- **Role-Customized (role_based)**:
  - General exploration: 🔍、💡、📬
  - Customer related: 👥、💼、🤝
  - Team related: 👨‍👩‍👧‍👦、💬、📋
  - Product related: 📱、🎨、✨

---

## Quality Checklist

After generating results, please self-check:

✅ Is each recommendation's \`title\` ≤15 characters?
✅ Have you selected an appropriate \`emoji\` for each recommendation?
✅ Have you avoided execution-type verbs ("reply", "schedule", "send")?
✅ Are all mentioned entities (names, events, platforms) present in the input data?
✅ Is at least 1 recommendation related to user's role/industry/focus topics?
✅ Have you prioritized user manually selected roles and focus topics?
✅ Does each recommendation contain a unique \`id\`?
✅ Is the output pure JSON without Markdown markers?

---

Your goal is to make users see 3 questions they **really need to understand** immediately when they open openloomi, rather than generic templates. Each recommendation should make users feel this is exactly what they need to explore.

**Language style requirements**:
- Use formal, professional expressions
- Avoid colloquial expressions (like "wassup", "whatcha mean", etc.)
- Use standard written language
- Keep it concise and clear, but not overly casual

---

## Language Requirements

**Important**: Output language must strictly follow the "understanding/reply language" setting configured in the user's assistant profile.

- If user sets Simplified Chinese (zh-Hans/zh-CN), all recommended conversation \`title\` fields must use Simplified Chinese
- If user sets English (en/en-US), all recommended conversation \`title\` fields must use English
- The system prompt will explicitly inform you of the user's language settings, please generate recommended conversations strictly according to that language

Now, please generate recommended conversations based on the input data.`;
}

/**
 * GET /api/chat/suggestions
 * Generate personalized suggested conversations
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new AppError("unauthorized:insight").toResponse();
  }

  try {
    // Set AI user context for proper billing in proxy mode
    setAIUserContextFromRequest({
      userId: session.user.id,
      email: session.user.email || "",
      name: session.user.name || null,
      userType: session.user.type,
      request,
    });
    const userId = session.user.id;
    const currentDate = new Date().toISOString().split("T")[0];

    // 1. Get user role information
    const roles = await getUserRoles(userId);
    const userRoles = roles.map((role) => ({
      role: role.roleKey,
      source: role.source,
      confidence: role.confidence,
    }));

    // 2. Get user identity information (industry, work description)
    const latestSurvey = await getLatestSurveyByUserId(userId);
    const industries = latestSurvey?.industry
      ? latestSurvey.industry
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
      : [];
    const workDescription = latestSurvey?.workDescription ?? null;

    // 3. Get user focus topics and language settings
    const settings = await getUserInsightSettings(userId);
    const focusTopics = settings?.focusTopics ?? [];
    const userLanguage = settings?.language || "zh-Hans"; // Default to Simplified Chinese

    // 4. Get insights from the past 24 hours
    const insights = await getLast24HoursInsights(userId);

    // 5. Format data
    const formattedInsights = insights.map(formatInsightForAPI);

    // 6. Build input data
    const inputData = {
      user_profile: {
        roles: userRoles,
        industries,
        workDescription,
        focusTopics,
      },
      insights: formattedInsights,
      current_date: currentDate,
    };

    // 7. Build user prompt
    const hasTodayInsights = formattedInsights.some((insight) =>
      isTodayEvent(insight.time, currentDate),
    );
    const hasHistoryInsights = formattedInsights.length > 0;

    // Build prompt based on user language settings
    const isChinese =
      userLanguage.includes("zh") ||
      userLanguage === "zh-Hans" ||
      userLanguage === "zh-CN";
    const languageInstruction = isChinese
      ? "Please generate recommended conversations in Simplified Chinese."
      : "Please generate suggested prompts in English.";

    const userPrompt = isChinese
      ? `Please generate 3 recommended conversations based on the following user data:

\`\`\`json
${JSON.stringify(inputData, null, 2)}
\`\`\`

**Important Notes**:
- **Output Language**: ${languageInstruction} All \`title\` fields in recommended conversations must use Simplified Chinese.
- **Language Style**: Please use formal, professional expressions, avoid colloquial expressions (like "what's up", "what did they say", etc.), use standard written language.
- Current Date: ${currentDate}
- If there are events in the \`insights\` array, determine if they are today's events by comparing the date part of the \`time\` field with the current date
- Scenario:
  ${
    hasTodayInsights
      ? "- **Scenario A**: Today has Insight events (today's events detected)"
      : hasHistoryInsights
        ? "- **Scenario B**: No Insight today, but has historical events (historical events provided, please generate pattern analysis questions based on these events)"
        : "- **Scenario C**: No any Insight events (new user, generate entirely based on role/industry/focus topics)"
  }

Please strictly return JSON in the output format, without any Markdown code block markers.`
      : `Please generate 3 suggested prompts based on the following user data:

\`\`\`json
${JSON.stringify(inputData, null, 2)}
\`\`\`

**Important Notes**:
- **Output Language**: ${languageInstruction} All \`title\` fields in suggested prompts must be in ${isChinese ? "Simplified Chinese" : "English"}.
- Current Date: ${currentDate}
- If there are events in the \`insights\` array, determine if they are today's events by comparing the date part of the \`time\` field with the current date.
- Scenario:
  ${
    hasTodayInsights
      ? "- **Scenario A**: Today has Insight events (today's events detected)"
      : hasHistoryInsights
        ? "- **Scenario B**: No Insight today, but has historical events (historical events provided, please generate pattern analysis questions based on these events)"
        : "- **Scenario C**: No Insight events (new user, generate entirely based on role/industry/focus topics)"
  }

Please return JSON in strict format without any Markdown code block markers.`;

    // 8. Call LLM to generate suggestions
    const systemPrompt = buildSystemPrompt();
    const modelProvider = getModelProvider(isTauriMode());
    const result = await generateText({
      model: modelProvider.languageModel("chat-model"),
      system: systemPrompt,
      prompt: userPrompt,
      temperature: 0.7,
      maxRetries: 3,
    });

    // 9. Parse response
    let responseText = result.text.trim();
    // Remove possible Markdown code block markers
    responseText = responseText.replace(/^```json\s*/i, "");
    responseText = responseText.replace(/^```\s*/i, "");
    responseText = responseText.replace(/\s*```$/i, "");

    let parsedResponse: z.infer<typeof SuggestionsResponseSchema>;
    try {
      const jsonData = JSON.parse(responseText);
      parsedResponse = SuggestionsResponseSchema.parse(jsonData);
    } catch (error) {
      console.error(
        "[Chat Suggestions] Failed to parse LLM response:",
        error,
        "Response:",
        responseText,
      );
      // If parsing fails, return default suggestions
      return Response.json({
        suggested_prompts: [
          {
            id: "suggest_fallback_1",
            title: "What important messages are there today?",
            emoji: "📬",
            type: "role_based" as const,
            reasoning: "Default recommendation: general exploration question",
            related_insight_ids: [],
          },
          {
            id: "suggest_fallback_2",
            title: "What are the main topics discussed by the team recently?",
            emoji: "💬",
            type: "role_based" as const,
            reasoning: "Default recommendation: team dynamics",
            related_insight_ids: [],
          },
          {
            id: "suggest_fallback_3",
            title: "What potential opportunities are there?",
            emoji: "💰",
            type: "role_based" as const,
            reasoning: "Default recommendation: business growth",
            related_insight_ids: [],
          },
        ],
      });
    }

    return Response.json(parsedResponse);
  } catch (error) {
    console.error("[Chat Suggestions] Failed to generate suggestions:", error);
    if (error instanceof AppError) {
      return error.toResponse();
    }
    return new AppError(
      "bad_request:insight",
      `Failed to generate suggestions: ${error instanceof Error ? error.message : String(error)}`,
    ).toResponse();
  }
}
