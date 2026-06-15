import {
  getConfiguredEmbeddingProvider,
  type EmbeddingProvider,
  type EmbeddingProviderFactoryOptions,
} from "./embedding-provider";

/**
 * Backwards-compatible embedding facade.
 *
 * Existing callers can continue to use UniversalEmbeddings while the actual
 * embedding implementation is selected through the provider abstraction.
 */
export class UniversalEmbeddings implements EmbeddingProvider {
  private provider: EmbeddingProvider;

  constructor(
    userAuthToken?: string,
    provider?: EmbeddingProvider,
    options: Omit<EmbeddingProviderFactoryOptions, "userAuthToken"> = {},
  ) {
    this.provider =
      provider ?? getConfiguredEmbeddingProvider({ ...options, userAuthToken });
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return this.provider.embedDocuments(texts);
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.provider.embedQuery(text);
  }

  getModelName(): string {
    return this.provider.getModelName();
  }

  getDimensions(): number | undefined {
    return this.provider.getDimensions();
  }
}
