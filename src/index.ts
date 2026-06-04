#!/usr/bin/env node

import 'dotenv/config';
import { config } from './config';
import { logger } from './utils/logger';
import { RAGServer } from './server';

async function main() {
  try {
    // Validate configuration
    config.validate();

    logger.info('Starting Raggy - Local RAG System');
    logger.info(`Version: 1.0.0`);
    logger.info(`Port: ${config.server.port}`);
    logger.info(`Host: ${config.server.host}`);

    // Create and start server
    const server = new RAGServer();
    await server.start();

    // Graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down gracefully...');
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down gracefully...');
      process.exit(0);
    });

  } catch (error) {
    logger.error('Failed to start Raggy', error);
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason: any) => {
  logger.error('Unhandled Rejection:', reason);
  process.exit(1);
});

// Start the application
main().catch((error) => {
  logger.error('Main function failed', error);
  process.exit(1);
});