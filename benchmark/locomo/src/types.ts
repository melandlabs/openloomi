/**
 * Types for LoCoMo benchmark evaluation.
 */

export enum RetrievalMode {
  DIALOG = "dialog",
  OBSERVATION = "observation",
  SESSION_SUMMARY = "session_summary",
}

export interface QAPair {
  question: string;
  answer: string;
  category: number;
  evidence: string[];
}

export interface LoCoMoSample {
  sample_id: string;
  conversation: Record<string, any>;
  observation: Record<string, any>;
  session_summary: Record<string, any>;
  event_summary: Record<string, any>;
  qa_pairs: QAPair[];
}

export interface EvaluationResult {
  sample_id: string;
  retrieval_mode: RetrievalMode;
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

export interface Prediction {
  question: string;
  answer: string;
  response: string;
  prediction: string;
  ground_truth: string;
  category: string;
  llm_score: number;
  correct: boolean;
  f1_score: number;
  bleu_score: number;
  bleu1: number;
  bleu2: number;
  bleu3: number;
  bleu4: number;
  evidence: string[];
}

export interface Chunk {
  id: string;
  content: string;
  embedding: number[];
  metadata: {
    sample_id: string;
    session_id: string;
    type: "dialog" | "observation" | "session_summary";
  };
}
