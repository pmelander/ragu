#!/usr/bin/env node

/**
 * Example: Upload a PDF or TXT file to Raggy (multipart API).
 *
 * Usage:
 *   node examples/upload-pdf.js path/to/file.pdf [collection-name]
 *   bun examples/upload-pdf.js path/to/notes.txt mycollection
 */

const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');

const RAGGY_URL = process.env.RAGGY_URL || 'http://localhost:3001';

async function uploadFile(filePath, collection = 'default') {
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    process.exit(1);
  }

  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.pdf' && ext !== '.txt') {
    console.error('❌ Only .pdf and .txt are supported');
    process.exit(1);
  }

  const fileName = path.basename(filePath);
  console.log(`📤 Uploading ${fileName} to collection "${collection}"...`);

  try {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    form.append('collection', collection);

    const response = await axios.post(`${RAGGY_URL}/api/documents/upload`, form, {
      headers: form.getHeaders(),
      timeout: 300000
    });

    const body = response.data;
    if (!body.success || !body.data) {
      console.error('❌ Upload failed:', body.error || 'Unknown error');
      process.exit(1);
    }

    const { documentId, chunksCount, processingTime } = body.data;
    console.log('✅ Upload successful!');
    console.log(`📊 Document ID: ${documentId}`);
    console.log(`🔢 Chunks indexed: ${chunksCount}`);
    console.log(`⚡ Processing time: ${processingTime}ms`);
  } catch (error) {
    const msg = error.response?.data?.error || error.message;
    console.error('❌ Upload failed:', msg);
    process.exit(1);
  }
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('Usage: node examples/upload-pdf.js <file.pdf|file.txt> [collection]');
  console.log('Example: node examples/upload-pdf.js ./report.pdf research');
  process.exit(1);
}

uploadFile(args[0], args[1] || 'default');
