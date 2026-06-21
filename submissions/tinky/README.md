# Workshop-05 — Discord Backfill (Tinky Oracle) 🎒

ระบบ **backfill ข้อความ Discord** ทั้งห้อง → เก็บลง SQLite+FTS5 → ค้นหาได้ → sync ข้อความใหม่ต่อได้ (idempotent)
ต่อยอดจากเครื่องมือเดิมของ Tinky `bot/src/peek.ts` (ตัวอ่านห้อง Discord แบบ pagination)

> โจทย์ครู nazt (06-18): *"ออกแบบระบบ backfill — โหลด data ทั้งหมดจาก Discord, index ไว้, แล้วคอย get data ใหม่ด้วย"*

## 🧠 เรียนจากงานเพื่อนก่อน (peers-first)

ก่อนเขียน อ่านงานเพื่อน 4 คน (Atom, Jizo, ViaLumen, ChaiKlang) + การคุยในห้อง 06-18
แล้ว**ออกแบบให้เลี่ยงกับดักที่เพื่อนเจอ**:

| กับดักที่เพื่อนเจอ | Tinky แก้ยังไง |
|---|---|
| **429 rate-limit** (เพื่อนแก้จริงแค่ 1/4 คน) | `fetchPage()` เคารพ `retry_after` + throttle 300ms/หน้า |
| ดึงซ้ำได้ข้อมูลซ้ำ | **upsert ด้วย `message_id` (snowflake)** → รันซ้ำ +0 แถว |
| ลบจริงทำข้อมูลหาย | **tombstone** (`deleted_at`) — Nothing is Deleted + `version` bump ตอน edit |
| crash แล้วเริ่มใหม่หมด | **cursor** (`oldest_id`/`newest_id`/`reached_start`) → resume ต่อจุดเดิม |
| **ค้นภาษาไทย FTS5 พัง** (เพื่อนต้องลง PyThaiNLP) | FTS5 + quote ทุก term กัน crash; งาน semantic ไทยให้สมอง CF bge-m3 ทำแยก (ไม่ปนข้อมูลดิบในสมองกลาง) |
| ดึงไม่ครบแล้วลบผิด (false-tombstone) | ลบ-by-absence เฉพาะช่วงที่ `reached_start=1` (ดึงครบแล้ว) |

## 🏗️ สถาปัตยกรรม

```
Discord (discord.js messages.fetch, 100/หน้า)
   │  ย้อนหลัง before=oldest  +  หัวใหม่ after=newest
   ▼
norm() → {id, channel_id, author, content, ts}
   ▼
SQLite: messages (PK=id, version, content_hash, deleted_at)
        cursors  (ต่อหลัง crash)
        messages_fts (FTS5 — ค้นข้อความ)
```

## ▶️ วิธีใช้
```bash
bun run backfill.ts <channelId>      # backfill เต็ม + ดึงใหม่ (รันซ้ำได้ idempotent)
bun run backfill.ts --search "<คำ>"  # ค้นใน DB (offline)
bun test backfill.test.ts            # parity gate (5 tests)
```

## ✅ Proof (รันจริง ไม่ใช่ภาพ)
ดู [`proof.txt`](./proof.txt) — backfill ห้องจริง #workshop-001 ได้ 8 ข้อความ,
รันซ้ำ **+0 แถว** (idempotent), ค้น FTS เจอ, parity-gate **5/5 ผ่าน**

## 📁 ไฟล์
- `backfill.ts` — store (SQLite+FTS5) + Discord glue + CLI
- `backfill.test.ts` — parity gate: idempotent / edit-version / tombstone / FTS / parity
- `proof.txt` — output การรันจริง

---
🤖 จัดทำโดย Tinky Oracle (AI) — Oracle never pretends to be human (Rule 6)
ขอบคุณเพื่อน Atom · Jizo · ViaLumen · ChaiKlang ที่ทำให้เรียนรู้กับดักก่อนเจอเอง 🙏
