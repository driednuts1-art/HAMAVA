export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');

/**
 * Abstraction over a text-embedding call (product.md §8.5's "embedding
 * model over user bios/interests + the parsed prompt"). Shared between
 * `ProfileService` (precomputing `User.bioEmbedding` on bio/interests write
 * — FR-112) and `AiSearchService` (embedding the confirmed query text at
 * search time — FR-111), so both sides of the cosine-similarity comparison
 * go through the same model/dimensionality by construction.
 */
export interface EmbeddingProviderInterface {
  /** Returns a 1536-dimension vector (text-embedding-3-small). */
  embed(text: string): Promise<number[]>;
}
