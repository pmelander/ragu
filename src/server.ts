import express from 'express';
import cors from 'cors';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from './utils/logger';
import { config } from './config';
import { ragService } from './core/rag-service';
import { RagError, ValidationError, NotFoundError } from './types/api';

export class RAGServer {
  private app: express.Application;
  private upload: multer.Multer;

  constructor() {
    this.app = express();
    this.upload = multer({
      dest: path.join(config.rag.documentsPath, 'temp'),
      limits: {
        fileSize: config.server.maxFileSizeMb * 1024 * 1024
      },
      fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (file.mimetype === 'application/pdf' || ext === '.pdf' ||
            file.mimetype === 'text/plain' || ext === '.txt' ||
            file.mimetype === 'text/markdown' || ext === '.md') {
          cb(null, true);
        } else {
          cb(new Error('Only PDF, TXT, and MD files are allowed'));
        }
      }
    });

    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  /**
   * Setup middleware
   */
  private setupMiddleware(): void {
    // CORS
    this.app.use(cors({
      origin: config.server.corsOrigin,
      credentials: true
    }));

    // Rate limiting
    this.app.use(rateLimit({
      windowMs: config.server.rateLimitWindow,
      max: config.server.rateLimitMaxRequests,
      standardHeaders: true,
      legacyHeaders: false,
      message: { success: false, error: 'Too many requests, please try again later.' }
    }));

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // Request logging
    this.app.use((req, res, next) => {
      logger.info(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      next();
    });
  }

  /**
   * Setup API routes
   */
  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      });
    });

    // System status
    this.app.get('/api/status', async (req, res) => {
      try {
        const status = await ragService.getStatus();
        res.json(status);
      } catch (error) {
        logger.error('Status check failed', error);
        res.status(500).json({ error: 'Status check failed' });
      }
    });

    // Upload document
    this.app.post('/api/documents/upload', this.upload.single('file'), async (req, res) => {
      try {
        const file = req.file;
        if (!file) {
          throw new ValidationError('No file uploaded');
        }

        const collection = req.body.collection || 'default';
        const metadata = req.body.metadata ? JSON.parse(req.body.metadata) : {};

        logger.info(`Upload request: ${file.originalname} to collection: ${collection}`);

        const result = await ragService.indexDocument(file.path, collection, metadata, file.originalname);

        // Clean up temp file
        fs.unlinkSync(file.path);

        res.json({
          success: true,
          data: result,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        logger.error('Upload failed', error);

        // Clean up temp file if it exists
        if (req.file?.path) {
          try {
            fs.unlinkSync(req.file.path);
          } catch {}
        }

        if (error instanceof RagError) {
          res.status(error.statusCode).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
          });
        } else {
          res.status(500).json({
            success: false,
            error: 'Upload failed',
            timestamp: new Date().toISOString()
          });
        }
      }
    });

    // Upload document via filePath (JSON)
    this.app.post('/api/upload', async (req, res) => {
      try {
        const { filePath, collection = 'default', metadata } = req.body;

        if (!filePath) {
          throw new ValidationError('filePath is required');
        }

        // Require absolute paths to prevent path traversal.
        if (!path.isAbsolute(filePath)) {
          throw new ValidationError('filePath must be an absolute path');
        }

        // Reject null bytes and control characters.
        if (/[\x00-\x1f\x7f]/.test(filePath)) {
          throw new ValidationError('filePath contains invalid characters');
        }

        if (!fs.existsSync(filePath)) {
          throw new ValidationError(`Path does not exist: ${filePath}`);
        }

        const stats = fs.statSync(filePath);
        let pdfFiles: string[] = [];

        if (stats.isDirectory()) {
          // Find all PDF/TXT files recursively
          function findFiles(dirPath: string): string[] {
            const files: string[] = [];
            const items = fs.readdirSync(dirPath);
            for (const item of items) {
              const fullPath = path.join(dirPath, item);
              const itemStats = fs.statSync(fullPath);
              if (itemStats.isDirectory()) {
                files.push(...findFiles(fullPath));
              } else if (item.toLowerCase().endsWith('.pdf') || item.toLowerCase().endsWith('.txt') || item.toLowerCase().endsWith('.md')) {
                files.push(fullPath);
              }
            }
            return files;
          }
          pdfFiles = findFiles(filePath);
          if (pdfFiles.length === 0) {
            throw new ValidationError(`No PDF, TXT, or MD files found in directory: ${filePath}`);
          }
        } else {
          if (!filePath.toLowerCase().endsWith('.pdf') && !filePath.toLowerCase().endsWith('.txt') && !filePath.toLowerCase().endsWith('.md')) {
            throw new ValidationError('Only PDF, TXT, and MD files are supported');
          }
          pdfFiles = [filePath];
        }

        const results = [];
        let totalChunks = 0;
        let totalProcessingTime = 0;

        for (const pdfFile of pdfFiles) {
          try {
            const result = await ragService.indexDocument(
              pdfFile,
              collection,
              metadata,
              path.basename(pdfFile)
            );
            results.push({
              file: path.basename(pdfFile),
              documentId: result.documentId,
              chunksCount: result.chunksCount,
              processingTime: result.processingTime
            });
            totalChunks += result.chunksCount;
            totalProcessingTime += result.processingTime;
          } catch (error: any) {
            logger.warn(`Failed to process ${pdfFile}:`, error);
            results.push({
              file: path.basename(pdfFile),
              error: error.message || 'Unknown error'
            });
          }
        }

        const successCount = results.filter(r => !r.error).length;
        const errorCount = results.filter(r => r.error).length;

        res.json({
          success: successCount > 0,
          data: {
            message: `Processed ${pdfFiles.length} files: ${successCount} successful, ${errorCount} failed`,
            collection,
            totalChunks,
            totalProcessingTime: `${totalProcessingTime}ms`,
            results
          },
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        logger.error('Upload via filePath failed', error);

        if (error instanceof RagError) {
          res.status(error.statusCode).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
          });
        } else {
          res.status(500).json({
            success: false,
            error: 'Upload failed',
            timestamp: new Date().toISOString()
          });
        }
      }
    });

    // Query documents
    this.app.post('/api/query', async (req, res) => {
      try {
        const { question, collection = 'default', limit, threshold } = req.body;

        if (!question?.trim()) {
          throw new ValidationError('Question is required');
        }

        logger.info(`Query request: "${question}" in collection: ${collection}`);

        const result = await ragService.query({
          question: question.trim(),
          collection,
          limit,
          threshold
        });

        res.json({
          success: true,
          data: result,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        logger.error('Query failed', error);

        if (error instanceof RagError) {
          res.status(error.statusCode).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
          });
        } else {
          res.status(500).json({
            success: false,
            error: 'Query failed',
            timestamp: new Date().toISOString()
          });
        }
      }
    });

    // List collections
    this.app.get('/api/collections', async (req, res) => {
      try {
        const collections = await ragService.listCollections();
        res.json({
          success: true,
          data: { collections },
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error('List collections failed', error);
        res.status(500).json({
          success: false,
          error: 'Failed to list collections',
          timestamp: new Date().toISOString()
        });
      }
    });

    // Get collection info
    this.app.get('/api/collections/:name', async (req, res) => {
      try {
        const { name } = req.params;
        const info = await ragService.getCollectionInfo(name);

        if (!info) {
          throw new NotFoundError(`Collection '${name}'`);
        }

        res.json({
          success: true,
          data: info,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        logger.error(`Get collection info failed: ${req.params.name}`, error);

        if (error instanceof RagError) {
          res.status(error.statusCode).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
          });
        } else {
          res.status(500).json({
            success: false,
            error: 'Failed to get collection info',
            timestamp: new Date().toISOString()
          });
        }
      }
    });

    // Delete collection
    this.app.delete('/api/collections/:name', async (req, res) => {
      try {
        const { name } = req.params;

        await ragService.deleteCollection(name);

        res.json({
          success: true,
          message: `Collection '${name}' deleted`,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        logger.error(`Delete collection failed: ${req.params.name}`, error);

        if (error instanceof RagError) {
          res.status(error.statusCode).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
          });
        } else {
          res.status(500).json({
            success: false,
            error: 'Failed to delete collection',
            timestamp: new Date().toISOString()
          });
        }
      }
    });
  }

  /**
   * Setup error handling
   */
  private setupErrorHandling(): void {
    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        timestamp: new Date().toISOString()
      });
    });

    // Global error handler
    this.app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      logger.error('Unhandled error', error);

      res.status(500).json({
        success: false,
        error: 'Internal server error',
        timestamp: new Date().toISOString()
      });
    });
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    try {
      // Initialize RAG service
      await ragService.initialize();

      // Start server
      this.app.listen(config.server.port, config.server.host, () => {
        logger.info(`RAG Server running on http://${config.server.host}:${config.server.port}`);
        logger.info(`CORS enabled for: ${config.server.corsOrigin}`);
      });

    } catch (error) {
      logger.error('Failed to start server', error);
      throw error;
    }
  }

  /**
   * Get the Express app (for testing)
   */
  getApp(): express.Application {
    return this.app;
  }
}