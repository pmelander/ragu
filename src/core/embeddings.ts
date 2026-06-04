import { logger } from '../utils/logger';
import { cache } from '../utils/cache';
import { config } from '../config';

export class LocalEmbeddingService {
  private extractor: any = null;
  private initialized = false;

  /**
   * Initialize the embedding model
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      logger.info(`Initializing embedding model: ${config.rag.embeddingModel}`);

      // Load the model - this might take a while on first run
      const { pipeline } = await import('@xenova/transformers');
      this.extractor = await pipeline('feature-extraction', config.rag.embeddingModel);

      this.initialized = true;
      logger.info('Embedding model initialized successfully');

    } catch (error) {
      logger.error('Failed to initialize embedding model', error as Error);
      throw new Error(`Embedding model initialization failed: ${(error as Error).message}`);
    }
  }

  /**
   * Generate embeddings for multiple texts (with batching for performance)
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    await this.ensureInitialized();

    const startTime = Date.now();
    const embeddings: number[][] = [];
    const BATCH_SIZE = 50; // Process 50 embeddings at a time

    try {
      logger.debug(`Generating embeddings for ${texts.length} texts (batched)`);

      for (let batchStart = 0; batchStart < texts.length; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, texts.length);
        const batch = texts.slice(batchStart, batchEnd);
        
        // Process batch in parallel
        const batchEmbeddings = await Promise.all(
          batch.map(async (text) => {
            // Check cache first
            let embedding = cache.getEmbedding(text);

            if (!embedding) {
              // Generate new embedding
              const output = await this.extractor(text, {
                pooling: 'mean',
                normalize: true
              });

              embedding = Array.from(output.data);

              // Cache the embedding
              cache.setEmbedding(text, embedding);
            }

            return embedding;
          })
        );

        embeddings.push(...batchEmbeddings);

        // Log progress
        logger.debug(`Processed ${batchEnd}/${texts.length} embeddings`);
      }

      const processingTime = Date.now() - startTime;
      logger.performance('Embedding generation', processingTime, {
        textsCount: texts.length,
        averageTimePerText: Math.round(processingTime / texts.length)
      });

      return embeddings;

    } catch (error) {
      logger.error('Embedding generation failed', error as Error);
      throw new Error(`Failed to generate embeddings: ${(error as Error).message}`);
    }
  }

  /**
   * Generate embedding for a single query
   */
  async generateQueryEmbedding(query: string): Promise<number[]> {
    await this.ensureInitialized();

    try {
      // Check cache first
      let embedding = cache.getEmbedding(query);

      if (!embedding) {
        const output = await this.extractor(query, {
          pooling: 'mean',
          normalize: true
        });

        embedding = Array.from(output.data);

        // Cache the embedding
        cache.setEmbedding(query, embedding);
      }

      return embedding;

    } catch (error) {
      logger.error('Query embedding generation failed', error as Error);
      throw new Error(`Failed to generate query embedding: ${(error as Error).message}`);
    }
  }

  /**
   * Ensure the model is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Get model information
   */
  getModelInfo(): { name: string; initialized: boolean } {
    return {
      name: config.rag.embeddingModel,
      initialized: this.initialized
    };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    // Note: This clears all cache, not just embeddings
    // In a production system, you'd want more granular cache clearing
    cache.clear();
    logger.info('Embedding cache cleared');
  }
}