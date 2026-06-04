# ragU

Local document **retrieval** server for PDF, TXT, and MD files. ragU does **not** generate answers — it returns **`context`** (retrieved passages) and **`sources`** (metadata) for your LLM to use.

**Stack:** Bun · TypeScript 5 · LanceDB (ANN vector search) · MiniSearch (keyword) · Reciprocal Rank Fusion · `@xenova/transformers` (local embeddings, no API key)

---

## How it works

1. **Index** — a document is split into sentence-aware, overlapping chunks. Each chunk is embedded locally using `paraphrase-multilingual-MiniLM-L12-v2` and stored in LanceDB. A MiniSearch lexical index is maintained in parallel.
2. **Query** — the question is embedded, then both ANN vector search and keyword search run against the collection. Results are fused with Reciprocal Rank Fusion (RRF) and filtered by similarity threshold. The top-N passages are returned as `context` and `sources`.
3. **Serve** — an Express HTTP server on `localhost:3001` exposes the indexing and retrieval operations. An MCP server (stdio) wraps the same API as native OpenCode tools.

Embeddings and search results are cached in-process (1 h / 30 min TTL respectively).

---

## Requirements

- [Bun](https://bun.sh) ≥ 1.1 (runtime and package manager)
- Node.js ≥ 18 (for the MCP server — `node mcp/ragu-mcp.js`)

---

## Quick start

```bash
git clone https://github.com/chironsb/ragu.git
cd ragu
bun install
cp .env.example .env        # edit as needed
bun run dev                 # starts on http://localhost:3001
```

On first run the embedding model (~120 MB) is downloaded and cached by `@xenova/transformers`.

---

## OpenCode integration (MCP)

The MCP server (`mcp/ragu-mcp.js`) exposes five native OpenCode tools. It auto-starts the ragU HTTP server if it isn't already running.

**Install (from repo root):**

```bash
chmod +x scripts/setup-opencode.sh
./scripts/setup-opencode.sh
```

This writes `~/.config/opencode/ragu-root.txt` (the absolute repo path) and patches `~/.config/opencode/opencode.json` with the MCP entry. Restart OpenCode afterward.

**Manual config** (if the script can't patch your JSON):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "ragu": {
      "type": "local",
      "command": ["node", "/absolute/path/to/ragu/mcp/ragu-mcp.js"],
      "enabled": true
    }
  }
}
```

The server port defaults to `3001`; override with `RAGGY_PORT`.

**Tools exposed to the LLM:**

| Tool | Description |
|------|-------------|
| `rag_query` | Search a collection; returns passages + sources |
| `rag_upload` | Index a file or directory (PDF/TXT/MD) |
| `rag_list` | List collections with document and chunk counts |
| `rag_status` | Server health, model info, cache stats |
| `rag_delete_collection` | Permanently remove a collection |

Collections are created automatically on first upload. Re-uploading a file with the same name into the same collection replaces rather than appends its chunks.

**Environment variable:** if OpenCode doesn't inherit your shell environment the MCP server reads the repo path from `~/.config/opencode/ragu-root.txt` (written by setup) or `RAGGY_PATH`.

### Embedding model

The chat/answer model is whatever OpenCode is configured to use. The embedding model (used by ragU for indexing and retrieval) is configured separately in ragU's `.env`:

```bash
EMBEDDING_MODEL=Xenova/paraphrase-multilingual-MiniLM-L12-v2
```

Changing the embedding model requires re-uploading all documents so vectors remain consistent.

---

## HTTP API

All responses use the envelope `{ success, data?, error?, timestamp }`. Query results live under `data`.

| Method | Path | Body / params | Description |
|--------|------|--------------|-------------|
| `GET` | `/health` | — | Liveness check |
| `GET` | `/api/status` | — | Model info, collections, cache stats |
| `POST` | `/api/documents/upload` | multipart: `file`, `collection`, `metadata` | Upload a single file |
| `POST` | `/api/upload` | JSON: `filePath`, `collection`, `metadata` | Index a file or directory by absolute path |
| `POST` | `/api/query` | JSON: `question`, `collection`, `limit?`, `threshold?` | Retrieve relevant passages |
| `GET` | `/api/collections` | — | List all collection names |
| `GET` | `/api/collections/:name` | — | Document count, chunk count, timestamps |
| `DELETE` | `/api/collections/:name` | — | Delete collection (vectors + lexical index + documents) |

**`/api/upload` requires an absolute path.** Relative paths and paths containing control characters are rejected with 400.

**Query response fields:**

```json
{
  "success": true,
  "data": {
    "context": "passage 1\n\n---\n\npassage 2",
    "sources": [
      {
        "content": "...",
        "score": 0.82,
        "vectorScore": 0.79,
        "rrfScore": 0.95,
        "metadata": { "source": "paper.pdf", "page": 3, "chunkIndex": 4, "totalChunks": 12 }
      }
    ],
    "processingTime": 38
  },
  "timestamp": "2026-06-04T12:00:00.000Z"
}
```

`answer` is also returned as an alias of `context` for backward compatibility.

---

## Configuration

Copy `.env.example` to `.env`. All values are optional; defaults are shown.

```bash
# Server
PORT=3001
HOST=localhost
CORS_ORIGIN=http://localhost:3000
MAX_FILE_SIZE_MB=50

# Rate limiting
RATE_LIMIT_WINDOW=900000          # ms (15 min)
RATE_LIMIT_MAX_REQUESTS=100

# Chunking
RAG_CHUNK_SIZE=1000               # characters per chunk
RAG_CHUNK_OVERLAP=200             # overlap between consecutive chunks
RAG_MAX_RESULTS=5                 # default result limit per query
RAG_SIMILARITY_THRESHOLD=0.35    # 0–1; lower = more permissive

# Hybrid search (vector + keyword, fused with RRF)
RAG_HYBRID_SEARCH=1               # 0 to disable (vector-only)
RAG_HYBRID_RELAX=1                # allow top keyword hits below vector threshold
RAG_HYBRID_VECTOR_POOL=48         # vector candidates fetched before fusion
RAG_HYBRID_LEXICAL_POOL=48        # keyword candidates fetched before fusion
RAG_RRF_K=60                      # RRF smoothing constant

# Storage paths
LANCE_DB_PATH=./data/lancedb
LEXICAL_INDEX_PATH=./data/lexical
DOCUMENTS_PATH=./data/documents
CACHE_PATH=./data/cache

# Embedding
EMBEDDING_MODEL=Xenova/paraphrase-multilingual-MiniLM-L12-v2

# Cache TTL (seconds)
CACHE_TTL=3600

# Logging
LOG_LEVEL=info
LOG_FILE=./logs/raggy.log
LOG_MAX_SIZE=10m                  # supports "10m", "512k", or bytes
LOG_MAX_FILES=5

# Vector ANN index threshold
RAG_VECTOR_INDEX_MIN_ROWS=64      # create ANN index after this many rows
```

---

## Examples

```bash
# Upload a file (multipart)
node examples/upload-pdf.js ./report.pdf research

# Query
node examples/query.js "What does the paper say about X?" research

# Interactive query session
node examples/query.js --interactive research
```

`RAGGY_URL` overrides the server address (default: `http://localhost:3001`).

---

## Commands

```bash
bun run dev          # start with hot reload
bun run build        # tsc → dist/
bun run start        # node dist/index.js (requires build)
bun run test         # jest (covers TextChunker and reciprocalRankFusion)
bun run lint         # eslint src/**/*.ts
```

---

## Data layout

```
data/
  lancedb/           # LanceDB tables (one per collection, base64url-named)
  lexical/           # MiniSearch JSON indexes (one per collection)
  documents/
    <collection>/    # archived copies of indexed source files
    temp/            # multipart upload staging (cleaned up after indexing)
logs/
  raggy.log          # file log (if LOG_FILE is set)
```

---

## Security notes

- ragU is a **local-only** service; it binds to `localhost` by default. Do not expose it publicly without adding authentication.
- `/api/upload` accepts only absolute paths and rejects control characters. The process can read any file it has permission to access, so restrict OS-level permissions accordingly.
- Rate limiting (100 req / 15 min) is applied globally. Adjust via `RATE_LIMIT_*` env vars.
