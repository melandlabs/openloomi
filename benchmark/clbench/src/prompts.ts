/**
 * Prompts for CL-bench rubric evaluation.
 */

// Rubric evaluation prompt for GPT-5.1 judge
export const RUBRIC_EVALUATION_PROMPT = `You are an impartial judge evaluating whether a response satisfies a given rubric criterion.
The response is from an AI assistant being evaluated on a context-learning benchmark.

TASK CONTEXT:
The assistant was given context in the form of a conversation (system prompt + user message).
You need to evaluate whether the assistant's response correctly satisfies the rubric.

RUBRIC TO EVALUATE:
{rubric}

ASSISTANT'S RESPONSE:
{response}

EVALUATION INSTRUCTIONS:
1. Carefully read the rubric criterion
2. Analyze whether the response satisfies it
3. Consider if the response demonstrates understanding of the context provided
4. Be strict but fair - the response must genuinely satisfy the criterion to be marked as passed

CRITICAL: You MUST return a valid JSON object with BOTH fields:
{
  "passed": true or false,
  "reasoning": "your explanation (2-3 sentences)"
}

Do NOT return anything other than the JSON object. The JSON must be valid and parseable.`;

// Low reasoning effort prompt for CL-bench (professional tasks)
export const CLBENCH_REASONING_EFFORT = "low";

// High reasoning effort prompt for CL-bench-Life (everyday life tasks)
export const CLBENCH_LIFE_REASONING_EFFORT = "high";
