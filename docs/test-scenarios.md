# Nemoris — manual test scenarios (WhatsApp)

Use this checklist when **LLM proxy**, **backend**, **Postgres**, **Chroma**, and **WAHA** are running and your WhatsApp session is **WORKING** (linked device). Send messages **to the number connected in WAHA** (the bot replies from Nemoris).

**Prerequisites**

- `DATABASE_URL` points at your running Postgres and **`npm run db:push`** has been applied at least once (otherwise user/reminder/memory writes can fail).
- Root `.env`: `LLM_PROVIDER=opencode`, `LLM_URL=http://localhost:4096`, `OPENAI_MODEL` aligned with the LLM service, `WAHA_API_KEY` matches `docker/waha.env`, `WAHA_URL=http://localhost:4130` (host backend).
- Webhook from WAHA → `http://host.docker.internal:3001/webhook` returns **200** in WAHA logs when the session becomes active.

**Out of scope in current WhatsApp handler**

- **Lists**: no list-specific intents in `handlers/message.js`; use **REST** under `/api` only if you add list routes later.
- Messages **`ping`**, **`PING`**, **`test`**, **`TEST`** (exact trim): processed but **no outbound reply** is sent (by design).

---

## 1. New user / welcome

| Step | You send (WhatsApp) | Expected |
|------|---------------------|----------|
| 1.1 | Any first text from a **new** `chatId`, e.g. `Hello` | After a short delay, a **welcome** text introducing **Nemoris** and mentioning memory, reminders, and questions (EN or ID depending on detected language). |
| 1.2 | Second message, e.g. `Hi again` | **No** second welcome; normal routing (likely treated as a **question** unless it matches reminder/memory patterns). |

---

## 2. Reminders (English)

| Step | You send | Expected |
|------|----------|----------|
| 2.1 | `remind me to drink water at 6pm` | Confirmation: **Reminder set**, quoted **task**, and a **due** line with a formatted date/time (locale EN). |
| 2.2 | `remind me to stretch every day at 9am` | Same style; if recurrence is parsed, text may include **daily** (or similar) per templates. |
| 2.3 | `remind me to do something` (no clear time) | **Reminder error** template: asks for a clearer form like *Remind me to [task] at [time]*. |

When the cron time hits, you should receive the **reminder message** on WhatsApp (subject to scheduler and WAHA connectivity).

---

## 3. Reminders (Indonesian)

| Step | You send | Expected |
|------|----------|----------|
| 3.1 | `ingatkan saya untuk minum air jam 7 malam` | **Pengingat sudah diatur** with task and **Waktunya:** (ID locale / Jakarta-style formatting). |
| 3.2 | Similar phrase with **besok** / **pagi** / **sore** | Parsed via Indonesian date helpers + chrono; success or clarification template if time is ambiguous. |

---

## 4. Memory — store

| Step | You send | Expected |
|------|----------|----------|
| 4.1 | `remember my birthday is December 25` | **Memory stored** style message; may include an LLM **summary** line if extraction succeeds. |
| 4.2 | `ingat bahwa nama saya adalah Andi` | ID template: memory **disimpan** / **mengingat** variant. |
| 4.3 | Phrase that matches memory patterns but LLM fails | Fallback: still stores memory; **default** “stored in my memory” message. |

**Side effects**: rows in Postgres (`memories`) and embeddings in **Chroma** when OpenAI embedding key is valid; otherwise memory text may still be in DB with degraded vector behavior.

---

## 5. Memory — retrieve (general question)

| Step | You send | Expected |
|------|----------|----------|
| 5.1 | After 4.1, ask `what is my birthday?` | Natural-language **answer** using LLM, informed by **retrieved memories** + recent **conversation history** (plain text, no markdown per system prompt). |
| 5.2 | Unrelated question with no prior memory | Still an LLM reply; may say it does not know if nothing relevant was stored. |

---

## 6. General chat (no reminder/memory keyword)

| Step | You send | Expected |
|------|----------|----------|
| 6.1 | `What is the capital of France?` | Short conversational answer from **OpenCode proxy** / configured model. |
| 6.2 | Mixed small talk | Same path as **question** intent; delays between messages follow **human-like** random delay settings. |

---

## 7. Optional — REST API (same machine)

Replace `CHAT_ID` with your WhatsApp id, e.g. `6281234567890@c.us`.

```bash
# User summary + counts
curl -sS "http://localhost:3001/api/users/CHAT_ID"

# List reminders
curl -sS "http://localhost:3001/api/users/CHAT_ID/reminders"

# List memories
curl -sS "http://localhost:3001/api/users/CHAT_ID/memories"
```

**Expected**: JSON arrays/objects; **404** if that `chatId` has never messaged the bot (user not created).

---

## 8. Health sanity

```bash
curl -sS http://localhost:3001/health
```

**Expected**: JSON with `status` and `services` flags; **waha** / **chroma** / **database** reflect reachability from the backend (your Postgres port may be **5434** if using `nemoris-postgres` — ensure `.env` matches).

---

## Failure hints

| Symptom | Likely cause |
|---------|----------------|
| No reply at all | Webhook not reaching backend; WAHA session not WORKING; backend not on **3001**. |
| Welcome only, then errors in logs | Prisma / DB (run **`db:push`**, check `DATABASE_URL`). |
| Reminder text but nothing at due time | Cron / `REMINDER_CHECK_INTERVAL`; reminder row `sent` state; WAHA send errors. |
| Memory question ignores facts | Embeddings missing (`OPENAI_API_KEY` for embeddings); or Chroma down. |
| LLM errors | `npm run proxy` stopped; `LLM_URL` / model / OpenCode auth. |

---

*Generated from current `handlers/message.js`, `services/parser.js`, and `routes/api.js` behavior.*
