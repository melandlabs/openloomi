/**
 * LoCoMo dataset loader.
 */

import { readFile } from "fs/promises";
import type { LoCoMoSample, QAPair } from "./types.js";

interface RawQAPair {
  question: string;
  answer?: string;
  category?: number | string;
  evidence?: string[];
}

interface RawSample {
  sample_id: string;
  conversation: Record<string, any>;
  observation?: Record<string, any>;
  session_summary?: Record<string, any>;
  event_summary?: Record<string, any>;
  qa?: RawQAPair[];
}

/**
 * Create QAPair from raw dictionary.
 */
function createQAPair(qa: RawQAPair): QAPair | null {
  // Skip QA pairs that don't have an answer field (e.g., adversarial questions)
  if (!qa.answer) {
    return null;
  }

  return {
    question: qa.question,
    answer: qa.answer,
    category:
      typeof qa.category === "string"
        ? Number.parseInt(qa.category, 10)
        : (qa.category ?? 0),
    evidence: qa.evidence ?? [],
  };
}

/**
 * Create LoCoMoSample from raw dictionary.
 */
export function createLoCoMoSample(data: RawSample): LoCoMoSample {
  const qaPairs: QAPair[] = [];

  if (data.qa) {
    for (const qa of data.qa) {
      const qaPair = createQAPair(qa);
      if (qaPair) {
        qaPairs.push(qaPair);
      }
    }
  }

  return {
    sample_id: data.sample_id,
    conversation: data.conversation ?? {},
    observation: data.observation ?? {},
    session_summary: data.session_summary ?? {},
    event_summary: data.event_summary ?? {},
    qa_pairs: qaPairs,
  };
}

/**
 * LoCoMo dataset loader.
 */
export class LoCoMoDataset {
  /**
   * Load LoCoMo dataset from JSON file.
   */
  static async loadFromJson(jsonPath: string): Promise<LoCoMoSample[]> {
    const content = await readFile(jsonPath, "utf-8");
    const data = JSON.parse(content);

    // Handle both single sample and list of samples
    if (Array.isArray(data)) {
      return data.map((sample) => createLoCoMoSample(sample));
    }
    return [createLoCoMoSample(data)];
  }
}
