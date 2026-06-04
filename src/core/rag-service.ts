import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import { cache } from '../utils/cache';
import { config } from '../config';
import { PDFProcessor } from './pdf-processor';
import { TextChunker } from './chunker';
import { LocalEmbeddingService } from './embeddings';
import { VectorStore } from './vector-store';
import {
  DocumentChunk,
  QueryRequest,
  QueryResponse,
  UploadResponse,
  CollectionInfo
} from '../types';

export class RAGService {
  private pdfProcessor: PDFProcessor;
  private chunker: TextChunker;
  private embeddings: LocalEmbeddingService;
  private vectorStore: VectorStore;
  private initialized = false;

  constructor() {
    this.pdfProcessor = new PDFProcessor();
    this.chunker = new TextChunker();
    this.embeddings = new LocalEmbeddingService();
    this.vectorStore = new VectorStore();
  }

  /**
   * Initialize all components
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const startTime = Date.now();

    try {
      logger.info('Initializing RAG Service...');

      await this.embeddings.initialize();
      this.ensureDirectories();
      await this.vectorStore.initialize();

      this.initialized = true;

      const initTime = Date.now() - startTime;
      logger.performance('RAG Service initialization', initTime);
    } catch (error) {
      logger.error('RAG Service initialization failed', error as Error);
      throw new Error(`Initialization failed: ${(error as Error).message}`);
    }
  }

  /**
   * Index a document (PDF or TXT)
   */
  async indexDocument(
    filePath: string,
    collectionName: string,
    metadata?: Record<string, any>,
    originalFilename?: string
  ): Promise<UploadResponse> {
    await this.ensureInitialized();

    const startTime = Date.now();
    const documentId = uuidv4();
    const lowerPath = (originalFilename ?? filePath).toLowerCase();
    const isPdf = lowerPath.endsWith('.pdf');
    const isMd = lowerPath.endsWith('.md');
    // isTxt covers both .txt and .md — both are treated as plain text by the processor
    const extension = isPdf ? '.pdf' : isMd ? '.md' : '.txt';

    try {
      logger.info(`Indexing document: ${filePath} into collection: ${collectionName}`);

      if (!this.pdfProcessor.validateFile(filePath, originalFilename)) {
        throw new Error('Invalid document file');
      }

      // Use the original filename as the canonical source name so that
      // re-uploads of the same file (e.g. via multipart upload where the temp
      // path changes each time) are correctly identified and deduplicated.
      const sourceName = originalFilename
        ? path.basename(originalFilename)
        : path.basename(filePath);

      // Deduplicate: remove any previously indexed chunks for this source so
      // re-uploading a file replaces rather than appends to existing chunks.
      await this.vectorStore.deleteBySource(collectionName, sourceName);

      let docMetadata: Record<string, unknown> = {};
      if (isPdf) {
        docMetadata = (await this.pdfProcessor.getMetadata(filePath)) || {};
      } else {
        const stats = fs.statSync(filePath);
        docMetadata = {
          pages: 1,
          title: path.basename(filePath, extension),
          fileSize: stats.size,
          fileName: path.basename(filePath)
        };
      }

      let pageChunks: { content: string; page: number }[];
      if (isPdf) {
        const pages = await this.pdfProcessor.extractPages(filePath, originalFilename);
        if (pages.length === 0 || !pages.some((p) => p.text.trim())) {
          throw new Error('No text could be extracted from document');
        }
        pageChunks = this.chunker.chunkTextWithPages(pages);
      } else {
        const text = await this.pdfProcessor.extractText(filePath, originalFilename);
        if (!text.trim()) {
          throw new Error('No text could be extracted from document');
        }
        pageChunks = this.chunker.chunkTextWithPages([{ page: 1, text }]);
      }

      if (pageChunks.length === 0) {
        throw new Error('No text could be extracted from document');
      }

      logger.debug(`Created ${pageChunks.length} chunks`);

      const chunks: DocumentChunk[] = pageChunks.map((pc, index) => ({
        id: `${documentId}_chunk_${index}`,
        content: pc.content,
        metadata: {
          // docMetadata provides document-level defaults (title, fileSize, etc);
          // user-supplied metadata overrides them. System fields below are always authoritative.
          ...docMetadata,
          ...metadata,
          source: sourceName,
          page: pc.page,
          chunkIndex: index,
          totalChunks: pageChunks.length,
          documentType: isPdf ? 'pdf' : isMd ? 'md' : 'txt'
        }
      }));

      const embeddings = await this.embeddings.generateEmbeddings(chunks.map((chunk) => chunk.content));

      await this.vectorStore.addDocuments(collectionName, chunks, embeddings);

      // Archive the source file. Failure here is non-fatal — the index is
      // already committed and usable. Log a warning rather than propagating.
      const destPath = path.join(config.rag.documentsPath, collectionName, `${documentId}${extension}`);
      this.ensureDirectory(path.dirname(destPath));
      try {
        fs.copyFileSync(filePath, destPath);
      } catch (copyError) {
        logger.warn(`Failed to archive document to ${destPath} — index is intact`, copyError);
      }

      const processingTime = Date.now() - startTime;

      logger.info(`Document indexed successfully`, {
        documentId,
        collection: collectionName,
        chunks: chunks.length,
        processingTime: `${processingTime}ms`
      });

      return {
        documentId,
        chunksCount: chunks.length,
        processingTime
      };
    } catch (error) {
      logger.error(`Document indexing failed: ${filePath}`, error as Error);
      throw new Error(`Indexing failed: ${(error as Error).message}`);
    }
  }

  private searchFingerprint(threshold: number | undefined, limit: number | undefined): string {
    return [
      config.rag.hybridSearch ? 'h1' : 'h0',
      config.rag.hybridRelaxThreshold ? 'r1' : 'r0',
      threshold ?? config.rag.similarityThreshold,
      limit ?? config.rag.maxResults
    ].join(':');
  }

  /**
   * Query the RAG system (retrieval only — combine `context` with your LLM in OpenCode or elsewhere)
   */
  async query(request: QueryRequest): Promise<QueryResponse> {
    await this.ensureInitialized();

    const startTime = Date.now();

    try {
      const { question, collection, limit, threshold } = request;

      logger.info(`Processing query: "${question}" in collection: ${collection}`);

      const fp = this.searchFingerprint(threshold, limit);
      const cachedResult = cache.getSearchResult(question, collection, fp);
      if (cachedResult) {
        logger.debug('Returning cached query result');
        return {
          ...cachedResult,
          processingTime: Date.now() - startTime
        };
      }

      const queryEmbedding = await this.embeddings.generateQueryEmbedding(question);

      const searchResults = await this.vectorStore.search(
        collection,
        queryEmbedding,
        question.trim(),
        limit || config.rag.maxResults,
        threshold !== undefined ? threshold : config.rag.similarityThreshold
      );

      const context = searchResults
        .map((result) => `[${result.metadata.source}, Page ${result.metadata.page ?? '?'}]\n${result.content}`)
        .join('\n\n---\n\n');

      const processingTime = Date.now() - startTime;

      const response: QueryResponse = {
        context: context || 'No relevant content found in the documents.',
        answer: context || 'No relevant content found in the documents.',
        sources: searchResults,
        processingTime
      };

      cache.setSearchResult(question, collection, { context: response.context, answer: response.answer, sources: response.sources }, fp);

      logger.info(`Query processed successfully`, {
        collection,
        resultsCount: searchResults.length,
        processingTime: `${processingTime}ms`
      });

      return response;
    } catch (error) {
      logger.error(`Query failed: ${request.question}`, error as Error);
      throw new Error(`Query failed: ${(error as Error).message}`);
    }
  }

  async listCollections(): Promise<string[]> {
    await this.ensureInitialized();
    return await this.vectorStore.listCollections();
  }

  async getCollectionInfo(name: string): Promise<CollectionInfo | null> {
    await this.ensureInitialized();

    const stats = await this.vectorStore.getCollectionStats(name);
    if (!stats) {
      return null;
    }

    const collectionPath = path.join(config.rag.documentsPath, name);
    let documentCount = 0;
    let createdAt = new Date();
    let lastModified = new Date();

    try {
      if (fs.existsSync(collectionPath)) {
        const dirStats = fs.statSync(collectionPath);
        createdAt = dirStats.birthtime;
        lastModified = dirStats.mtime;
        const files = fs.readdirSync(collectionPath);
        documentCount = files.filter(
          (file) => file.endsWith('.pdf') || file.endsWith('.txt') || file.endsWith('.md')
        ).length;
      }
    } catch (error) {
      logger.warn(`Could not count documents in collection: ${name}`, error);
    }

    return {
      name,
      documentCount,
      chunkCount: stats.count,
      createdAt,
      lastModified
    };
  }

  async deleteCollection(name: string): Promise<void> {
    await this.ensureInitialized();

    await this.vectorStore.deleteCollection(name);

    const collectionPath = path.join(config.rag.documentsPath, name);
    try {
      if (fs.existsSync(collectionPath)) {
        fs.rmSync(collectionPath, { recursive: true, force: true });
        logger.info(`Deleted collection documents: ${name}`);
      }
    } catch (error) {
      logger.warn(`Could not delete collection documents: ${name}`, error);
    }
  }

  async getStatus(): Promise<{
    initialized: boolean;
    embeddingModel: { name: string; initialized: boolean };
    retrieval: { backend: string; hybridSearch: boolean };
    collections: string[];
    cacheStats: ReturnType<typeof cache.getStats>;
  }> {
    return {
      initialized: this.initialized,
      embeddingModel: this.embeddings.getModelInfo(),
      retrieval: {
        backend: 'lancedb',
        hybridSearch: config.rag.hybridSearch
      },
      collections: await this.listCollections(),
      cacheStats: cache.getStats()
    };
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private ensureDirectories(): void {
    const dirs = [
      config.rag.lanceDbPath,
      config.rag.lexicalIndexPath,
      config.rag.documentsPath,
      path.join(config.rag.documentsPath, 'temp'),
      config.rag.cachePath,
      'logs'
    ];

    for (const dir of dirs) {
      this.ensureDirectory(dir);
    }
  }

  private ensureDirectory(dirPath: string): void {
    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        logger.debug(`Created directory: ${dirPath}`);
      }
    } catch (error) {
      logger.error(`Failed to create directory: ${dirPath}`, error);
    }
  }
}

export const ragService = new RAGService();
