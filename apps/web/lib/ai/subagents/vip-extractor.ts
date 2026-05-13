import { generateText } from "ai";
import { modelProvider } from "@/lib/ai";
import { z } from "zod";
import { jsonrepair } from "jsonrepair";
import { extractJsonFromMarkdown } from "@openloomi/ai";

/**
 * System prompt for VIP extraction from Insights
 */
export const vipExtractionSystemPrompt = `## Role Definition

You are a professional assistant responsible for analyzing user's conversation insights and extracting important people (VIPs) based on communication patterns, relationship importance, and interaction frequency.

### Task

Analyze the provided insights and identify people who should be marked as VIPs. VIPs are individuals who:
1. Have frequent and important communication with the user
2. Are decision makers or key stakeholders in important projects
3. Have high influence or authority
4. Are mentioned in high-importance or high-urgency insights
5. Have ongoing commitments or action items involving the user
6. Are key contacts from important organizations or platforms

### Data Format

Each insight contains:
- \`title\`: Insight title
- \`desc\`: Insight description (abbreviated from "description")
- \`people\`: List of people mentioned in this insight
- \`imp\`: Importance level (abbreviated from "importance")
- \`urg\`: Urgency level (abbreviated from "urgency")
- \`tasks\`: User's tasks in this insight
- \`wait\`: Items waiting for others (abbreviated from "waitingForOthers")
- \`details\`: Conversation details with people

### Selection Criteria

**Include as VIP if:**
- The person appears in multiple insights with high importance ("重要", "Important", "high")
- The person has action items (tasks, commitments) involving the user
- The person is a decision maker, executive, or key stakeholder
- The person represents an important organization or company
- Communication frequency is high (appears in many different insights)
- The person has direct 1-on-1 conversations with the user
- The person is involved in critical projects or topics

**Exclude if:**
- Only appears in group announcements or broadcasts
- Only appears in low-importance information sharing
- Is a bot or automated system
- Only appears once or twice with no significant interaction
- Is mentioned in passing without direct involvement

### Output Requirements

Output valid JSON ONLY (no markdown formatting, no \`\`\`json wrapper):

{
  "vips": [
    {
      "name": "Person Name",
      "reason": "Brief reason why this person is a VIP (1-2 sentences)",
      "confidence": 0.9
    }
  ],
  "summary": "Brief summary of the analysis (2-3 sentences)"
}

**Fields:**
- \`name\`: The person's name as it appears in insights (use the most common variation)
- \`reason\`: Explain why they qualify as VIP based on the insights
- \`confidence\`: Score from 0.0 to 1.0 indicating how confident you are that this person should be a VIP
- \`summary\`: Overall summary of the VIP extraction process

**Limitations:**
- Maximum 5 VIPs
- Only include people with confidence >= 0.7
- Sort by confidence (highest first)
`;

const VIPExtractionResultSchema = z.object({
  vips: z
    .array(
      z.object({
        name: z.string(),
        reason: z.string(),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(20),
  summary: z.string(),
});

export type VIPExtractionResult = z.infer<typeof VIPExtractionResultSchema>;

const maxRetries = 5;

/**
 * Calculate insight relevance score for VIP extraction
 * Higher score = more likely to contain VIP information
 */
function calculateInsightRelevanceScore(insight: {
  title?: string | null;
  description?: string | null;
  people?: string[] | null;
  importance?: string | null;
  urgency?: string | null;
  myTasks?: Array<{ title?: string | null; owner?: string | null }> | null;
  waitingForOthers?: Array<{
    title?: string | null;
    responder?: string | null;
  }> | null;
  details?: Array<{
    person?: string | null;
    content?: string | null;
  } | null> | null;
}): number {
  let score = 0;

  // Has people mentioned (most important)
  if (insight.people && insight.people.length > 0) {
    score += 10;
  }

  // Has personal details/conversations
  if (insight.details && insight.details.length > 0) {
    score += 8;
  }

  // High importance
  if (
    insight.importance === "重要" ||
    insight.importance === "Important" ||
    insight.importance === "high"
  ) {
    score += 5;
  }

  // High urgency
  if (
    insight.urgency &&
    !insight.urgency.includes("not") &&
    insight.urgency !== "low"
  ) {
    score += 3;
  }

  // Has myTasks (indicates active collaboration)
  if (insight.myTasks && insight.myTasks.length > 0) {
    score += 4;
  }

  // Has waitingForOthers (indicates ongoing interactions)
  if (insight.waitingForOthers && insight.waitingForOthers.length > 0) {
    score += 4;
  }

  return score;
}

/**
 * Extract VIPs from insights using AI analysis
 */
export const extractVIPsFromInsights = async (
  insights: Array<{
    title?: string | null;
    description?: string | null;
    people?: string[] | null;
    importance?: string | null;
    urgency?: string | null;
    myTasks?: Array<{ title?: string | null; owner?: string | null }> | null;
    waitingForOthers?: Array<{
      title?: string | null;
      responder?: string | null;
    }> | null;
    details?: Array<{
      person?: string | null;
      content?: string | null;
    } | null> | null;
  }>,
): Promise<{
  result: VIPExtractionResult;
  retries: number;
}> => {
  // Filter and prioritize insights by relevance
  const scoredInsights = insights
    .map((insight) => ({
      insight,
      score: calculateInsightRelevanceScore(insight),
    }))
    .sort((a, b) => b.score - a.score);

  // Take top insights by relevance (max 100 for context management)
  const MAX_INSIGHTS = 100;
  const topInsights = scoredInsights
    .slice(0, MAX_INSIGHTS)
    .map((item) => item.insight);

  // Prepare insights data for analysis - compact format
  const insightsData = topInsights.map((insight) => ({
    title: insight.title ?? "",
    desc: insight.description ?? "", // Shorter key name
    people: insight.people ?? [],
    imp: insight.importance ?? "medium", // Shorter key name
    urg: insight.urgency ?? "not_urgent", // Shorter key name
    tasks: insight.myTasks ?? [], // Shorter key name
    wait: insight.waitingForOthers ?? [], // Shorter key name
    details: insight.details ?? [],
  }));

  const userPrompt = `Analyze the following conversation insights and extract VIPs:

<insights>
${JSON.stringify(insightsData)}
</insights>

Based on the communication patterns, importance, and relationships shown in these insights, identify the VIPs.
`;

  const conversation: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [
    { role: "system", content: vipExtractionSystemPrompt },
    { role: "user", content: userPrompt },
  ];

  // Initial generation
  const response = await generateText({
    model: modelProvider().languageModel("chat-model"),
    messages: conversation,
    maxRetries: 5,
  });

  conversation.push({ role: "assistant", content: response.text });
  let currentJson = extractJsonFromMarkdown(response.text) ?? response.text;
  let retries = 0;

  // Check initial output
  const parseResult = VIPExtractionResultSchema.safeParse(
    JSON.parse(currentJson),
  );
  if (parseResult.success) {
    return {
      result: parseResult.data,
      retries: 0,
    };
  }

  // Multi-round repair
  while (retries < maxRetries) {
    retries++;
    console.log(`[VIP Extractor] Round ${retries} repair`);

    const repairPrompt = `
Please fix and output the complete JSON result again. The previous output had issues, please ensure the output conforms to the following schema:
{
  "vips": [
    {
      "name": "string",
      "reason": "string",
      "confidence": number (0-1)
    }
  ],
  "summary": "string"
}

Requirements:
1. Only output JSON, no markdown format
2. vips array maximum 5 elements
3. confidence must be between 0-1
4. Only include VIPs with confidence >= 0.7
`;

    conversation.push({ role: "user", content: repairPrompt });

    const repairResponse = await generateText({
      model: modelProvider().languageModel("chat-model"),
      messages: conversation,
    });

    conversation.push({ role: "assistant", content: repairResponse.text });
    currentJson =
      extractJsonFromMarkdown(repairResponse.text) ?? repairResponse.text;

    const parseResult = VIPExtractionResultSchema.safeParse(
      JSON.parse(currentJson),
    );
    if (parseResult.success) {
      return {
        result: parseResult.data,
        retries,
      };
    }
  }

  // Final attempt with jsonrepair
  try {
    const repairedJson = jsonrepair(currentJson);
    const parseResult = VIPExtractionResultSchema.safeParse(
      JSON.parse(repairedJson),
    );
    if (parseResult.success) {
      return {
        result: parseResult.data,
        retries: maxRetries,
      };
    }
  } catch (error) {
    console.error("[VIP Extractor] Final json repair failed", error);
  }

  console.error("[VIP Extractor] Failed to extract VIPs");
  throw new Error("VIP extraction failed");
};
