/**
 * Custom embeddings implementation that can use OpenAI or OpenRouter API.
 * All configuration is read from environment variables.
 * The calling app is responsible for setting the appropriate env vars.
 */

const EMBEDDING_BASE_URL =
  process.env.LLM_EMBEDDING_BASE_URL || "https://openrouter.ai/api/v1";

/**
 * Custom embeddings implementation that can use OpenAI or OpenRouter API.
 * Auth strategy is determined by the base URL and env vars set by the caller.
 */
export class UniversalEmbeddings {
  private apiKey: string;
  private modelName: string;
  private baseURL: string;
  private userAuthToken?: string;

  constructor(userAuthToken?: string) {
    this.apiKey =
      process.env.OPENAI_EMBEDDINGS_API_KEY ||
      process.env.OPENROUTER_API_KEY ||
      process.env.LLM_API_KEY ||
      "";

    this.userAuthToken = userAuthToken;
    this.modelName =
      process.env.LLM_EMBEDDING_MODEL || "text-embedding-3-small";
    this.baseURL = EMBEDDING_BASE_URL;
  }

  /**
   * Generate embeddings for multiple texts.
   */
  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      throw new Error("No texts provided for embedding");
    }

    const batchSize = 100;
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchEmbeddings = await this.callEmbeddingAPI(batch);
      results.push(...batchEmbeddings);
    }

    return results;
  }

  /**
   * Generate embedding for a single query text.
   */
  async embedQuery(text: string): Promise<number[]> {
    const embeddings = await this.callEmbeddingAPI([text]);
    return embeddings[0];
  }

  /**
   * Call embeddings API (OpenAI-compatible).
   */
  private async callEmbeddingAPI(texts: string[]): Promise<number[][]> {
    console.log("[RAG] Calling embeddings API:", {
      baseURL: this.baseURL,
      model: this.modelName,
      textCount: texts.length,
      hasApiKey: !!this.apiKey,
      hasUserAuthToken: !!this.userAuthToken,
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;

      if (this.baseURL.includes("openrouter.ai")) {
        headers["HTTP-Referer"] =
          process.env.NEXT_PUBLIC_APP_URL || "https://openloomi.ai";
        headers["X-Title"] = "openloomi AI";
      }
    } else if (this.userAuthToken) {
      headers.Authorization = `Bearer ${this.userAuthToken}`;
    }

    const response = await fetch(`${this.baseURL}/embeddings`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.modelName,
        input: texts,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const errorMessage = `Embeddings API error (${response.status}): ${errorText}`;
      throw new Error(errorMessage);
    }

    const data = await response.json();

    if (!data.data || !Array.isArray(data.data)) {
      throw new Error(
        `Invalid response format from embeddings API. Expected data.data array.`,
      );
    }

    const sortedData = data.data.sort((a: any, b: any) => a.index - b.index);

    return sortedData.map((item: any) => {
      if (!item.embedding || !Array.isArray(item.embedding)) {
        throw new Error("Invalid embedding format in response");
      }
      return item.embedding;
    });
  }
}
