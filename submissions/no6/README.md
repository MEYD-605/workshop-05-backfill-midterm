# 🛸 No.6 Gemini — Discord Indexer Subgraph & Vector 2-Track Architecture (Design v3)

This repository contains the complete implementation of **No.6 Gemini's Discord Indexer**, built on a Graph-Node style block architecture, hybrid search (lexical + semantic), and multi-agent cluster isolation.

---

## 📐 Architecture Specification

### 1. Graph-Node style Block Ingestion
- **Block chain-hash**: Message batches are grouped into virtual "blocks" where each block computes `parent_hash` and `hash` (linking to the previous block's hash) to guarantee block-chain integrity and zero-gap assurance.
- **REST Backfill**: Recursively fetches historical messages using `before` cursors (100 messages per call, rate-limited to stay under 429 limits).
- **WebSocket Gateway Sync**: Subscribes to Discord WebSocket gateway events (`MESSAGE_CREATE`) for real-time live ingestion.

### 2. Double-Track Storage & Search
- **Lexical Track**: SQLite `FTS5` virtual table with BM25 ranking for exact matching of commands, code snippets, and IDs.
- **Semantic Track**: Dense vector embeddings (768-dims) processed locally using ONNX/Ollama (`nomic-embed-text`) stored in `sqlite-vec` or `LanceDB` with HNSW indices.
- **Hybrid Fusion**: Computes search relevance using a weighted fusion: `0.65 * FTS + 0.35 * Vector`.

### 3. Cluster Isolation & Concurrency
- **Atomic Claim Gateway**: Uses an atomic CAS-under-lock database claim per channel, ensuring only one agent in the Oracle council cluster indexes a channel/thread at any given time (preventing lock contentions).

---

## 📁 Repository Structure

```text
├── index.html           # Beautiful, interactive 3D Web Dashboard (Visual UI & Simulator)
├── package.json         # Project package manifest
├── README.md            # Architecture documentation (this file)
└── src/
    ├── discordgraph.yaml # Subgraph manifest configuration
    ├── indexer.ts       # Core Bun/TS indexer engine
    └── schema.sql       # SQLite tables & FTS5 virtual table definition
```

---

## 🚀 Getting Started

### Prerequisites
- [Bun](https://bun.sh) runtime installed.
- Discord Bot Token configured in environment (`DISCORD_BOT_TOKEN`).

### Installation
```bash
bun install
```

### Running the Indexer CLI
1. **Deploy Schema**:
   ```bash
   bun run src/indexer.ts deploy
   ```
2. **Execute Backfill**:
   ```bash
   bun run src/indexer.ts backfill 500
   ```
3. **Check Status**:
   ```bash
   bun run src/indexer.ts status
   ```
4. **Query (Hybrid Search)**:
   ```bash
   bun run src/indexer.ts query "your search query"
   ```

---
🤖 **No.6 Gemini จาก ai-core [Context: ~15%]**
