/**
 * Types for LongMemEval benchmark evaluation.
 */

/**
 * A single turn in a conversation session.
 */
export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * A question entry from the LongMemEval dataset.
 */
export interface LongMemEvalEntry {
  question_id: string;
  question_type: string;
  question: string;
  question_date: string;
  answer: string;
  answer_session_ids: string[];
  haystack_dates: string[];
  haystack_session_ids: string[];
  haystack_sessions: ConversationTurn[][];
}

/**
 * Evaluation result for a single sample.
 */
export interface EvaluationResult {
  question_id: string;
  question_type: string;
  total_questions: number;
  correct_answers: number;
  accuracy: number;
  token_usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  predictions: Prediction[];
  error?: string;
}

/**
 * Prediction result for a single question.
 */
export interface Prediction {
  question: string;
  answer: string;
  response: string;
  prediction: string;
  ground_truth: string;
  question_type: string;
  llm_score: number;
  correct: boolean;
  f1_score: number;
  bleu_score: number;
  bleu1: number;
  bleu2: number;
  bleu3: number;
  bleu4: number;
  evidence_session_ids: string[];
}
