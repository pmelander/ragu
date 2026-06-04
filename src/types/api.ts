// API specific types
export interface ApiQueryRequest {
  question: string;
  collection: string;
  limit?: number;
  threshold?: number;
}

export interface ApiUploadRequest extends FormData {
  collection: string;
  metadata?: string; // JSON string
}

export interface ApiCollectionListResponse {
  collections: string[];
}

export interface ApiCollectionInfoResponse {
  name: string;
  documentCount: number;
  chunkCount: number;
  createdAt: string;
  lastModified: string;
}

// Error types
export class RagError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = 'RagError';
  }
}

export class ValidationError extends RagError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
  }
}

export class NotFoundError extends RagError {
  constructor(resource: string) {
    super(`${resource} not found`, 'NOT_FOUND', 404);
  }
}