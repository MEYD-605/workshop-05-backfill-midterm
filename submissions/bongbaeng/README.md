# 🐆 bongbaeng — Discord Backfill + Index + Hybrid Search

Workshop 05 Midterm submission. ออกแบบ + สร้าง + test ระบบ backfill Discord ตาม **design v3**
(ดู discussion #6 สำหรับ design evolution v1→v3).

> โหลด data ทั้งหมดจาก Discord → index → ค้นได้ → คอย get ใหม่ต่อเนื่อง

## ทำไม v3 ดีกว่า kikyo (reference ที่เรียนมา)
| | kikyo | bongbaeng v3 |
|---|---|---|
| ingest | one-shot snapshot (re-mirror ทุกครั้ง) | **incremental** ผ่าน watermark (ดึงเฉพาะใหม่) |
| edit/delete | DELETE+rebuild index | **edit_history + tombstone** (Nothing is Deleted) |
| verify | parity check ✓ (เก็บไว้) | parity check ✓ + auto gap-heal (cursor) |
| search | hybrid FTS5+hashed-vector ✓ | hybrid FTS5+vector (swap-able backend) |

## คำสั่ง
```bash
bun cli.ts backfill <channel-id> [--limit=N] [--guild=ID]   # ดึง+index (incremental)
bun cli.ts search "<query>" [--mode=fts|vector|hybrid]       # ค้น FTS5+vector fusion
bun cli.ts stats                                             # messages/edits/deleted/channels
```
token: `DISCORD_BOT_TOKEN` env หรือ `pass show discord/atlas-oracle-token` · db: `$BACKFILL_DB`

## สถาปัตยกรรม
```
Discord REST (before-cursor, 100/batch, 429 backoff)
  → upsertMessage (incremental, edit_history versioning, tombstone)
  → SQLite: messages + edit_history + cursors(watermark) + messages_fts(FTS5) + message_vectors
  → checkParity (expected vs actual + missing ids = verify ไม่เดา)
  → search: bm25 × 0.65 + cosine × 0.35 (ข้าม tombstoned)
```
VectorBackend: hashed embedding (zero-dep, offline) — swap point สำหรับ real embedding (nomic-embed-text / text-embedding-3-small)

## Test
```bash
bun test        # 8 pass — insert/parity/edit-history/tombstone/hybrid/watermark/embed/stats
bun run typecheck
```
proven บน real data: backfill 300 msgs Oracle School channel → parity ✓ → incremental re-run จับข้อความใหม่ได้ (ดู `screenshots/demo.png`)

🤖 bongbaeng Oracle (AI · Rule 6) · จาก ก้อง → bongbaeng-oracle
