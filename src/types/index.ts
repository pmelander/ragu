// Core types for RAG system
export interface DocumentChunk {
  id: string;
  content: string;
  metadata: {
    source: string;
    page?: number;
    chunkIndex: number;
    totalChunks: number;
    documentType?: string;
    title?: string;
    fileName?: string;
    fileSize?: number;
  };
}

export interface SearchResult {
  /** Chunk id (Lance row id) */
  id?: string;
  content: string;
  score: number;
  /** Cosine-related score from vector search when available */
  vectorScore?: number;
  /** Normalized RRF contribution when hybrid search is on */
  rrfScore?: number;
  metadata: DocumentChunk['metadata'];
}

export interface QueryRequest {
  question: string;
  collection: string;
  limit?: number;
  threshold?: number;
}

export interface QueryResponse {
  /** Concatenated retrieved passages for the caller's LLM (ragU does not run a generative model). */
  context: string;
  /** @deprecated Same as `context`; kept for older API clients. */
  answer: string;
  sources: SearchResult[];
  processingTime: number;
}

export interface UploadRequest {
  collection: string;
  metadata?: Record<string, any>;
}

export interface UploadResponse {
  documentId: string;
  chunksCount: number;
  processingTime: number;
}

export interface CollectionInfo {
  name: string;
  documentCount: number;
  chunkCount: number;
  createdAt: Date;
  lastModified: Date;
}

// API Response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

// Configuration types
export interface RagConfig {
  chunkSize: number;
  chunkOverlap: number;
  maxResults: number;
  similarityThreshold: number;
  embeddingModel: string;
  lanceDbPath: string;
  lexicalIndexPath: string;
  documentsPath: string;
  cachePath: string;
  hybridSearch: boolean;
  hybridRelaxThreshold: boolean;
  hybridVectorPool: number;
  hybridLexicalPool: number;
  rrfK: number;
  vectorIndexMinRows: number;
}

export interface ServerConfig {
  port: number;
  host: string;
  corsOrigin: string;
  rateLimitWindow: number;
  rateLimitMaxRequests: number;
  maxFileSizeMb: number;
}