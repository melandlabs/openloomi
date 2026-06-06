# Local Embeddings and Vector Backends

OpenLoomi can generate embeddings locally with Transformers.js and store
vectors in either SQLite through `sqlite-vec` or a ChromaDB server.

## Local embeddings

Add the following values to `apps/web/.env`:

```dotenv
EMBEDDING_PROVIDER=local
LOCAL_EMBEDDING_MODEL=Xenova/bge-large-zh-v1.5
LOCAL_EMBEDDING_BATCH_SIZE=8
LOCAL_EMBEDDING_MAX_TOKENS=512
LOCAL_EMBEDDING_CACHE_DIR=.openloomi/models
LOCAL_EMBEDDING_DEVICE=cpu
LOCAL_EMBEDDING_LOCAL_ONLY=false
```

The first run downloads the selected model. After the model is cached, set
`LOCAL_EMBEDDING_LOCAL_ONLY=true` for fully offline startup. A mirror can be
configured when direct Hugging Face access is unavailable:

```dotenv
LOCAL_EMBEDDING_REMOTE_HOST=https://hf-mirror.com
```

The supported Node.js execution devices depend on the installed
Transformers.js/ONNX runtime. The currently tested values are `cpu` and `dml`;
`wasm` is not a valid Node.js device value for this runtime.

Embedding models have a maximum token length. Inputs longer than
`LOCAL_EMBEDDING_MAX_TOKENS` are truncated by the tokenizer before inference.

## sqlite-vec

The desktop app defaults to `sqlite-vec`:

```dotenv
VECTOR_STORE_BACKEND=sqlite-vec

# Optional per-source overrides
RAG_VECTOR_STORE_BACKEND=sqlite-vec
RAW_MESSAGE_VECTOR_STORE_BACKEND=sqlite-vec
INSIGHT_VECTOR_STORE_BACKEND=sqlite-vec

# Optional collection names for the generic stores
SQLITE_VEC_RAG_COLLECTION=openloomi_rag_chunks
SQLITE_VEC_INSIGHTS_COLLECTION=openloomi_insights
```

Raw messages use dimension-specific tables such as
`raw_messages_vec_d1024`. Their names are intentionally fixed because each
table is tied to the source `raw_messages` table and its delete trigger.

RAG and insight vectors use generic collection tables:

```text
openloomi_vec_<collection>_records
openloomi_vec_<collection>_d<dimensions>
```

The package creates a new dimension table when the embedding model changes,
so a reindex can move records from 384 to 1024 dimensions without mixing
incompatible vectors. The embedding dream repairs missing, stale, or
model-mismatched application records and synchronizes them to the configured
vector backend.

The native `sqlite-vec` extension is bundled with the Tauri server runtime. It
does not require Docker or a separate database service.

## ChromaDB

The current Chroma adapter uses client-server mode. Start a local server:

```bash
docker run --rm -p 8000:8000 -v openloomi-chroma:/data chromadb/chroma:1.5.3
```

Then configure OpenLoomi:

```dotenv
VECTOR_STORE_BACKEND=chroma
CHROMA_URL=http://localhost:8000

CHROMA_RAG_COLLECTION=openloomi_rag_chunks
CHROMA_RAW_MESSAGES_COLLECTION=openloomi_raw_messages
CHROMA_INSIGHTS_COLLECTION=openloomi_insights
```

Individual sources can use different backends by setting
`RAG_VECTOR_STORE_BACKEND`, `RAW_MESSAGE_VECTOR_STORE_BACKEND`, or
`INSIGHT_VECTOR_STORE_BACKEND`.

OpenLoomi always supplies embeddings to Chroma explicitly. Chroma's default
embedding function is disabled to avoid additional model downloads and
dimension drift.

Chroma collections accept only one embedding dimension. When changing to a
model with different dimensions, use a new collection name or clear and
reindex the existing collection.

## Runtime verification

Semantic search logs identify the backend that actually handled a query:

```text
[RAG] Vector search completed { ..., backend: 'sqlite-vec' }
[SQLite Raw Messages] Semantic search completed { backend: 'sqlite-vec', ... }
[InsightSearch] Semantic search completed { backend: 'sqlite-vec', ... }
```

If sqlite-vec is unavailable, raw message and insight search explicitly log
`stored-embedding-fallback`. This makes backend fallback visible instead of
silently changing query behavior.

## Tests

Run the focused backend tests:

```bash
pnpm --filter web exec vitest run \
  tests/unit/local-transformers-embedding-provider.test.ts \
  tests/unit/unified-vector-search-service.test.ts \
  tests/unit/sqlite-vec-store.test.ts \
  tests/unit/chroma-vector-store.test.ts \
  tests/unit/sqlite-raw-message-storage.test.ts
```

Run the complete web test suite and type checker before submitting changes:

```bash
pnpm --filter web test
pnpm --filter web tsc --noEmit
```
