---
description: Alternate OpenCode agent sketch — prefer opencode-integration/agent/RAG.md for the real RAG agent
mode: primary
tools:
  ragu: true
---

# ragU (reference)

This file is a **short reference** for what ragU does. The maintained agent instructions live in **`opencode-integration/agent/RAG.md`** (installed to `~/.config/opencode/agent/RAG.md` by `scripts/setup-opencode.sh`).

## Role

- **ragU** = local **retrieval**: PDF/TXT/MD → chunks → embeddings (Xenova) → **LanceDB** + optional **MiniSearch** hybrid (**RRF**).
- The **chat model** answers; ragU returns **`context`** + **`sources`**, not the final prose reply.

## OpenCode tool

Use the **`ragu`** tool (`ragu status`, `ragu upload`, `ragu query`, `ragu list`, `ragu stop`).

## Stack (current)

| Piece | Notes |
|-------|--------|
| Embeddings | `@xenova/transformers` (model from `.env`) |
| Vectors | LanceDB (`data/lancedb`) |
| Keyword | MiniSearch indexes under `data/lexical` when hybrid is on |
| API | `http://localhost:3001` — see README |

## Practices

- Same **collection** name for upload and query.
- After changing **EMBEDDING_MODEL**, re-upload documents.

Everything stays on your machine unless you configure otherwise.
