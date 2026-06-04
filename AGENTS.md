# ragU

Local document retrieval server (PDF, TXT, MD). Uses LanceDB (vector ANN) + MiniSearch (keyword) fused with Reciprocal Rank Fusion. Returns `context` + `sources` — does **not** generate answers.

## Stack

- **Runtime**: Bun ≥ 1.1 (`bun run dev` to start, `bun install` for deps)
- **Language**: TypeScript 5, `module: Node16`, `strict: true`
- **Vector store**: LanceDB + MiniSearch hybrid, RRF fusion (`src/core/vector-store.ts`)
- **Embeddings**: `@xenova/transformers` local model, no API key needed (`src/core/embeddings.ts`)
- **HTTP**: Express on `localhost:3001` (`src/server.ts`)
- **Tests**: Jest + ts-jest (`bun run test`)

## Commands

```bash
bun run dev          # start server with hot reload
bun run build        # tsc → dist/
bun run test         # jest
bun run lint         # eslint
./scripts/setup-opencode.sh  # register MCP server, plugin, and /ragu-index command
```

## Project structure

```
src/
  index.ts           # process entry, signal handlers
  server.ts          # Express routes, multer upload
  config/index.ts    # env-driven singleton config
  core/
    rag-service.ts   # orchestrator (index, query, collections)
    pdf-processor.ts # PDF/TXT/MD text extraction (pdfjs-dist)
    chunker.ts       # sentence-aware overlapping chunks
    embeddings.ts    # local transformer embeddings
    vector-store.ts  # LanceDB + MiniSearch + RRF
    hybrid-rrf.ts    # Reciprocal Rank Fusion
  types/             # domain types + API error classes
  utils/
    cache.ts         # node-cache (TTL in seconds)
    logger.ts        # winston (LOG_LEVEL env var)
mcp/
  ragu-mcp.js              # MCP server — exposes ragU as native OpenCode tools
  ragu-project-plugin.js   # OpenCode plugin — auto-indexes projects on first startup
  ragu-index.md            # /ragu-index custom command template
scripts/
  setup-opencode.sh  # registers MCP server, plugin, and command in ~/.config/opencode/
```

## API routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api/status` | Server, model, collection, cache stats |
| POST | `/api/documents/upload` | Multipart file upload |
| POST | `/api/upload` | JSON `{ filePath, collection }` — absolute path to file or directory |
| POST | `/api/query` | `{ question, collection, limit?, threshold? }` |
| GET | `/api/collections` | List collections |
| GET | `/api/collections/:name` | Collection info |
| DELETE | `/api/collections/:name` | Delete collection |

Response envelope: `{ success, data?, error?, timestamp }`.

## Key conventions

- Collection names are base64url-encoded to LanceDB table names.
- Cache TTL values are in **seconds** (`node-cache` convention). Default: 3600 s (1 h).
- `LOG_MAX_SIZE` supports `"10m"`, `"512k"`, or raw byte strings.
- Supported file types: `.pdf`, `.txt`, `.md` — all treated as text post-extraction.
- `docMetadata` (title, fileSize, fileName) spread before user `metadata`; system fields (source, page, chunkIndex) are always last and authoritative.
- `/api/upload` requires an absolute `filePath`; relative paths are rejected with 400.
- Re-uploading a file with the same name into the same collection replaces existing chunks (deduplication by source filename).

## Project support

When OpenCode starts in a project that has ragU set up, the plugin (`mcp/ragu-project-plugin.js`) runs automatically:

1. **First startup** — creates `.opencode/ragu.json` with a sensible default config (collection name = folder name, paths = any of `docs/`, `README.md`, `AGENTS.md`, `CHANGELOG.md`, `CONTRIBUTING.md` that exist). Then indexes those paths into ragU.
2. **Subsequent startups** — config already exists, nothing happens.
3. **Manual re-index** — run `/ragu-index` in the TUI at any time to re-trigger indexing from the current config.

`.opencode/ragu.json` schema:

```json
{
  "collection": "my-project",
  "paths": ["docs", "README.md", "AGENTS.md"]
}
```

- `collection` — ragU collection name (defaults to the project folder name).
- `paths` — relative paths to index; each may be a file or directory. Directories are scanned recursively for `.pdf`, `.txt`, `.md` files. An empty array means no auto-indexing; the user populates it manually and runs `/ragu-index`.

## RAG knowledge base

A local ragU retrieval server is available via MCP tools (`rag_query`, `rag_upload`,
`rag_list`, `rag_status`, `rag_delete_collection`).

**Use `rag_query` proactively** — before answering questions about this codebase,
its architecture, or any domain for which documents have been indexed.
Call `rag_list` first if you are unsure which collections exist.

Do not wait to be asked. If a question could be informed by indexed documents,
retrieve context first, then answer.
