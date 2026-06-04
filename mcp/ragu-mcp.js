#!/usr/bin/env node
'use strict';

/**
 * ragU MCP Server
 *
 * Exposes ragU's retrieval API as native MCP tools for OpenCode.
 * The LLM can call rag_query, rag_upload, rag_list, rag_status, and
 * rag_delete_collection autonomously — no user command required.
 *
 * Transport: JSON-RPC 2.0 over stdio (stdout = protocol, stderr = logs).
 * No external dependencies; runs with `node` or `bun`.
 *
 * Register in ~/.config/opencode/opencode.json:
 *   "mcp": {
 *     "ragu": {
 *       "type": "local",
 *       "command": ["node", "/absolute/path/to/ragu/mcp/ragu-mcp.js"],
 *       "enabled": true
 *     }
 *   }
 */

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ─── Config ──────────────────────────────────────────────────────────────────

// __dirname is always the mcp/ folder; the ragU root is one level up.
const RAGGY_ROOT = path.resolve(__dirname, '..');
const PORT = parseInt(process.env.RAGGY_PORT || '3001', 10);
const STARTUP_TIMEOUT_MS = 15000;
const STARTUP_POLL_MS = 400;
const REQUEST_TIMEOUT_MS = 30000;

// ─── Logging (stderr only — stdout is reserved for MCP protocol) ─────────────

function log(msg) {
  process.stderr.write(`[ragu-mcp] ${msg}\n`);
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function httpRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const options = {
      hostname: 'localhost',
      port: PORT,
      path: urlPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    };

    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => (raw += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, body: raw });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error(`Request to ${urlPath} timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });

    if (payload) req.write(payload);
    req.end();
  });
}

async function isServerUp() {
  try {
    const r = await httpRequest('GET', '/health');
    return r.status === 200;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Server lifecycle ─────────────────────────────────────────────────────────

let startAttempted = false;

async function ensureServer() {
  if (await isServerUp()) return;
  if (startAttempted) {
    throw new Error(
      'Raggy server is not running and a prior start attempt failed. ' +
      `Run \`bun run dev\` in ${RAGGY_ROOT} manually, then retry.`
    );
  }
  startAttempted = true;

  const pkgPath = path.join(RAGGY_ROOT, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error(
      `Raggy package.json not found at ${RAGGY_ROOT}. ` +
      'Set the correct path in your MCP command or RAGGY_PATH env var.'
    );
  }

  log(`Starting Raggy server in ${RAGGY_ROOT} ...`);

  // Prefer bun (native runtime); fall back to npx if bun isn't on PATH.
  const child = spawn('bun', ['run', 'dev'], {
    cwd: RAGGY_ROOT,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, RAGGY_PATH: RAGGY_ROOT }
  });
  child.on('error', () => {
    // bun not found — try npm as fallback (slower first-start, but works)
    const npmChild = spawn('npm', ['run', 'dev'], {
      cwd: RAGGY_ROOT,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, RAGGY_PATH: RAGGY_ROOT }
    });
    npmChild.on('error', (e) => log(`npm fallback also failed: ${e.message}. Run \`bun run dev\` in ${RAGGY_ROOT} manually.`));
    npmChild.unref();
  });
  child.unref();

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(STARTUP_POLL_MS);
    if (await isServerUp()) {
      log('Raggy server is up.');
      return;
    }
  }

  throw new Error(
    `Raggy server did not respond within ${STARTUP_TIMEOUT_MS / 1000}s. ` +
    `Check logs in ${path.join(RAGGY_ROOT, 'logs')}.`
  );
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'rag_query',
    description:
      'Search the local RAG knowledge base for content relevant to a question or topic. ' +
      'Call this proactively whenever you need context from indexed documents — ' +
      'architecture docs, API references, runbooks, PDFs, or markdown files — ' +
      'before answering questions or making implementation decisions. ' +
      'Returns retrieved passages and their sources.',
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The question or topic to search for.'
        },
        collection: {
          type: 'string',
          description: 'Collection name to search (default: "default"). Use rag_list to discover available collections.'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 5, max: 20).'
        },
        threshold: {
          type: 'number',
          description: 'Minimum similarity score 0–1 (default: 0.35). Lower = more permissive.'
        }
      },
      required: ['question']
    }
  },
  {
    name: 'rag_upload',
    description:
      'Index a PDF, TXT, or MD file — or a directory of such files — into the local RAG ' +
      'knowledge base so their content can be retrieved by rag_query. ' +
      'Call this when asked to ingest, index, or add documents. ' +
      'Directories are scanned recursively.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path to a PDF, TXT, or MD file, or a directory containing such files.'
        },
        collection: {
          type: 'string',
          description: 'Collection name to index into (default: "default").'
        }
      },
      required: ['file_path']
    }
  },
  {
    name: 'rag_list',
    description:
      'List all document collections currently indexed in the RAG knowledge base. ' +
      'Call this to discover what documentation is available before querying.',
    inputSchema: {
      type: 'object',
      properties: {
      }
    }
  },
  {
    name: 'rag_status',
    description:
      'Check whether the Raggy retrieval server is online and return model, retrieval backend, ' +
      'and cache statistics.',
    inputSchema: {
      type: 'object',
      properties: {
      }
    }
  },
  {
    name: 'rag_delete_collection',
    description:
      'Permanently remove a collection and all its indexed documents from the RAG knowledge base. ' +
      'This cannot be undone.',
    inputSchema: {
      type: 'object',
      properties: {
        collection: {
          type: 'string',
          description: 'Name of the collection to delete.'
        }
      },
      required: ['collection']
    }
  }
];

// ─── Tool implementations ─────────────────────────────────────────────────────

async function callTool(name, args) {
  // All tools except rag_status need the server; rag_status starts it too.
  await ensureServer();

  switch (name) {
    case 'rag_query': {
      const r = await httpRequest('POST', '/api/query', {
        question: args.question,
        collection: args.collection || 'default',
        limit: Math.min(args.limit || 5, 20),
        ...(args.threshold !== undefined ? { threshold: args.threshold } : {})
      });

      const d = r.body?.data || r.body;
      if (!d || r.status >= 400) {
        throw new Error(d?.error || `Query failed (HTTP ${r.status})`);
      }

      const sources = (d.sources || []).map(s => {
        const meta = s.metadata || {};
        return `[${meta.source || '?'}, p.${meta.page ?? '?'}, score=${s.score?.toFixed(3) ?? '?'}]`;
      });

      return [
        `## RAG context — ${sources.length} source(s) · ${d.processingTime ?? '?'}ms`,
        '',
        d.context || 'No relevant content found.',
        '',
        sources.length ? `**Sources:** ${sources.join(' · ')}` : ''
      ].join('\n').trimEnd();
    }

    case 'rag_upload': {
      const r = await httpRequest('POST', '/api/upload', {
        filePath: args.file_path,
        collection: args.collection || 'default'
      });

      const d = r.body?.data || r.body;
      if (!d || r.status >= 400) {
        throw new Error(d?.error || `Upload failed (HTTP ${r.status})`);
      }

      const results = d.results || [];
      const ok = results.filter(x => !x.error);
      const fail = results.filter(x => x.error);

      const lines = [
        `Indexed ${ok.length} file(s) into collection "${args.collection || 'default'}".`
      ];
      if (d.totalChunks) lines.push(`Total chunks: ${d.totalChunks}`);
      if (d.totalProcessingTime) lines.push(`Processing time: ${d.totalProcessingTime}`);
      if (ok.length) lines.push(`Files: ${ok.map(x => x.file).join(', ')}`);
      if (fail.length) {
        lines.push(`\nFailed (${fail.length}):`);
        for (const f of fail) lines.push(`  ${f.file}: ${f.error}`);
      }

      return lines.join('\n');
    }

    case 'rag_list': {
      const r = await httpRequest('GET', '/api/collections');
      const cols = r.body?.data?.collections || [];

      if (cols.length === 0) {
        return 'No collections found. Use rag_upload to index documents first.';
      }

      // Fetch per-collection stats in parallel
      const details = await Promise.all(
        cols.map(async (name) => {
          try {
            const info = await httpRequest('GET', `/api/collections/${encodeURIComponent(name)}`);
            const d = info.body?.data || {};
            return `  ${name}: ${d.documentCount ?? '?'} document(s), ${d.chunkCount ?? '?'} chunks`;
          } catch {
            return `  ${name}`;
          }
        })
      );

      return [`Collections (${cols.length}):`, ...details].join('\n');
    }

    case 'rag_status': {
      const r = await httpRequest('GET', '/api/status');
      const d = r.body?.data || r.body;

      if (!d || r.status >= 400) {
        throw new Error(`Status check failed (HTTP ${r.status})`);
      }

      const emb = d.embeddingModel || {};
      const ret = d.retrieval || {};
      const cols = d.collections || [];

      return [
        `Status: online`,
        `Embedding model: ${emb.name || 'N/A'} (ready: ${emb.initialized ?? '?'})`,
        `Retrieval: ${ret.backend || 'lancedb'} | hybrid search: ${ret.hybridSearch ? 'on' : 'off'}`,
        `Collections (${cols.length}): ${cols.join(', ') || 'none'}`,
        `Cache — keys: ${d.cacheStats?.keys ?? 0}, hits: ${d.cacheStats?.hits ?? 0}, misses: ${d.cacheStats?.misses ?? 0}`
      ].join('\n');
    }

    case 'rag_delete_collection': {
      const col = args.collection;
      if (!col) throw new Error('"collection" is required');

      const r = await httpRequest('DELETE', `/api/collections/${encodeURIComponent(col)}`);

      if (r.status >= 400) {
        const msg = r.body?.error || `Delete failed (HTTP ${r.status})`;
        throw new Error(msg);
      }

      return r.body?.message || `Collection "${col}" deleted.`;
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── JSON-RPC 2.0 transport (newline-delimited over stdio) ───────────────────

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function respondError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handleMessage(msg) {
  const { id, method, params } = msg;

  // ── Handshake ──
  if (method === 'initialize') {
    respond(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'ragu', version: '1.0.0' }
    });
    return;
  }

  // Notifications (no id, no response)
  if (method === 'notifications/initialized' || method === 'initialized') return;

  if (method === 'ping') {
    respond(id, {});
    return;
  }

  // ── Tool listing ──
  if (method === 'tools/list') {
    respond(id, { tools: TOOLS });
    return;
  }

  // ── Tool invocation ──
  if (method === 'tools/call') {
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};

    try {
      const text = await callTool(toolName, toolArgs);
      respond(id, {
        content: [{ type: 'text', text }]
      });
    } catch (err) {
      // Return the error as tool content (not a JSON-RPC error) so the LLM
      // sees the message and can decide how to handle it.
      respond(id, {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true
      });
    }
    return;
  }

  // ── Unknown method ──
  if (id !== undefined && id !== null) {
    respondError(id, -32601, `Method not found: ${method}`);
  }
}

// ─── Stdin reader (newline-delimited JSON) ────────────────────────────────────

let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop(); // Retain any incomplete trailing line

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch (err) {
      log(`Failed to parse JSON: ${err.message} — input: ${trimmed.slice(0, 120)}`);
      continue;
    }
    handleMessage(msg).catch(err => log(`Unhandled error in message handler: ${err.message}`));
  }
});

process.stdin.on('end', () => {
  // Stdin closed (client disconnected). Let any in-flight tool calls drain
  // before exiting — Node will exit on its own once the event loop is empty.
  // Do not call process.exit() here; that would kill pending async handlers.
});
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

log(`Raggy MCP server ready (root: ${RAGGY_ROOT}, port: ${PORT})`);
