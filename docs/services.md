---
title: Nemoris — Services Overview
description: What runs in Nemoris, what each piece is for, and where it lives in the repo.
---

# Nemoris services

This document lists **runtime services** and the **main backend app** that make up Nemoris: what each one does, how it is usually started, and **where the code or config lives** in this repository.

> **Preview tip:** Open this file with [Markdown Preview Enhanced](https://shd101wyy.github.io/markdown-preview-enhanced/). Turn on **Mermaid** in the extension settings so the architecture diagram renders. You can also enable **`[TOC]`** and place `[TOC]` on its own line anywhere to auto-generate a second outline.

## Contents

- [At a glance](#sec-glance)
- [How the pieces connect](#sec-diagram)
- [PostgreSQL (`nemoris_db`)](#sec-postgres)
- [ChromaDB (`nemoris_chroma`)](#sec-chroma)
- [WAHA (`nemoris_waha`)](#sec-waha)
- [Nemoris backend (`nemoris_backend`)](#sec-backend)
- [LLM service](#sec-llm)
- [Scripts and compose profiles](#sec-compose)
- [Summary](#sec-summary)

---

<a id="sec-glance"></a>

## At a glance

| Service | Role | Typical URL / port | Where it lives |
|--------|------|--------------------|----------------|
| **PostgreSQL** | Relational data (users, reminders, lists, etc.) | Host: `localhost:5442` → DB `nemoris` | Docker: `docker/docker-compose.yml` → `nemoris_db` |
| **ChromaDB** | Vector store for Nemoris **memory** (embeddings + retrieval) | `http://localhost:8001` | Docker: `nemoris_chroma` |
| **WAHA** | WhatsApp HTTP API (sessions, send/receive) | Dashboard/API: `http://localhost:4130` | Docker: `nemoris_waha` · image: Core `devlikeapro/waha:gows-arm` (or `gows` on amd64) · secrets: `docker/waha.env` |
| **Nemoris backend** | Express API, WhatsApp webhook, scheduling, business logic | `http://localhost:3001` | Code: `apps/backend/` · Docker: `nemoris_backend` |
| **LLM service** | OpenCode-backed proxy (OpenAI-style `/v1/chat/completions`) | `http://localhost:4096` | Code: `apps/llm-service/` · Docker profile: `llm` (`nemoris_llm_service`) |

---

<a id="sec-diagram"></a>

## How the pieces connect

```mermaid
flowchart LR
  subgraph users["Users"]
    WA["WhatsApp client"]
  end

  subgraph docker["Docker (typical profile: all)"]
    WAHA["WAHA\nhost :4130"]
    PG[("PostgreSQL\n:5442")]
    CH["ChromaDB\n:8001"]
    BE["Nemoris backend\n:3001"]
  end

  subgraph host["Host (often required)"]
    LLM["LLM service\n(OpenCode proxy)\n:4096"]
  end

  WA <-->|messages| WAHA
  WAHA <-->|HTTP| BE
  BE --> PG
  BE --> CH
  BE -->|LLM_PROVIDER / LLM_URL| LLM
```

---

<a id="sec-postgres"></a>

## PostgreSQL (`nemoris_db`)

**Used for** persistent structured data accessed through **Prisma**: users linked to WhatsApp `chatId`, reminders (including scheduling metadata), lists, and other MVP entities.

**Where it lives**

| Item | Path / reference |
|------|------------------|
| Container & volume | `docker/docker-compose.yml` → service `nemoris_db` |
| Schema & migrations | `apps/backend/prisma/` (schema, migrations) |
| DB connection helper | `apps/backend/src/config/database.js` |

**Default local access:** `postgresql://nemoris:nemoris123@localhost:5442/nemoris` (see compose file for container-internal host `nemoris_db`).

---

<a id="sec-chroma"></a>

## ChromaDB (`nemoris_chroma`)

**Used for** **memory**: storing and querying text with embeddings so Nemoris can retrieve relevant past context (RAG-style) when handling messages.

**Where it lives**

| Item | Path / reference |
|------|------------------|
| Container & volume | `docker/docker-compose.yml` → service `nemoris_chroma` |
| Client / integration | `apps/backend/src/config/chroma.js`, `apps/backend/src/services/memory.js` |

**Default local URL:** `http://localhost:8001` (mapped from container port 8000).

---

<a id="sec-waha"></a>

## WAHA — WhatsApp HTTP API (`nemoris_waha`)

**Used for** linking a WhatsApp account (QR / sessions), receiving inbound events, and sending outbound messages. Nemoris does not talk to Meta’s APIs directly in this setup; it talks to **WAHA**.

**Where it lives**

| Item | Path / reference |
|------|------------------|
| Container & sessions volume | `docker/docker-compose.yml` → `nemoris_waha` · Core GOWS: `/app/.sessions` · Plus GOWS: `/app/sessions` (see compose comments) |
| WAHA env (API key, dashboard, hooks) | `docker/waha.env` (from `docker/waha.env.example`) |
| WAHA client usage | `apps/backend/src/config/waha.js` |
| Inbound path | Webhook mounted under `apps/backend/src/routes/webhook.js` → handlers |

**Dashboard:** `http://localhost:4130` (set username/password in `docker/waha.env`; use the same `WAHA_API_KEY` in repo root `.env` for the backend).

---

<a id="sec-backend"></a>

## Nemoris backend (`nemoris_backend`)

**Used for** the **main application**: Express server, **health** checks, **WhatsApp webhook**, internal **API** routes, **reminder** scheduling and delivery, **list** and **reminder** logic, **parsing** user text (EN/ID), **memory** orchestration, and calls to the **LLM** and **OpenAI/embeddings** helpers as implemented in services.

**Where it lives**

| Area | Path |
|------|------|
| App entry | `apps/backend/src/index.js` |
| Routes | `apps/backend/src/routes/webhook.js`, `apps/backend/src/routes/api.js` |
| Message handling | `apps/backend/src/handlers/message.js` |
| Business logic | `apps/backend/src/services/` — e.g. `reminder.js`, `memory.js`, `parser.js`, `openai.js`, `health.js` |
| Integrations config | `apps/backend/src/config/` — `database.js`, `chroma.js`, `waha.js` |
| Container build | `apps/backend/Dockerfile` · compose service `nemoris_backend` |

**Health endpoint:** `GET http://localhost:3001/health` reports database, Chroma, and WAHA reachability.

---

<a id="sec-llm"></a>

## LLM service — OpenCode proxy (`nemoris_llm_service` or host)

**Used for** exposing an **OpenAI-compatible** HTTP API (`POST /v1/chat/completions`) that forwards work to the **OpenCode** CLI. The Nemoris backend can use `LLM_PROVIDER=opencode` and `LLM_URL` pointing at this service (from Docker, often `http://host.docker.internal:4096`).

**Where it lives**

| Item | Path / reference |
|------|------------------|
| Source | `apps/llm-service/src/index.js` |
| Container (optional profile) | `docker/docker-compose.yml` → `nemoris_llm_service` (profile `llm`) |
| Root script | `npm run proxy` / `npm run dev:llm` from repo `package.json` |

> **Note:** Full containerization may require OpenCode inside the image; local development often runs **`npm run proxy`** on the host so OpenCode is available.

---

<a id="sec-compose"></a>

## Scripts and compose profiles

| Goal | Command / file |
|------|----------------|
| Start full Docker stack (db + chroma + waha + backend) | `docker compose -f docker/docker-compose.yml --profile all up -d` or `./scripts/start-all.sh` |
| Start only database | `--profile db` |
| Add Chroma / WAHA | `--profile chroma`, `--profile waha` |
| Optional LLM in Docker | `--profile llm` |

Compose file path: **`docker/docker-compose.yml`**. Environment for local dev is typically **`.env`** at the repository root (referenced by the backend service).

---

<a id="sec-summary"></a>

## Summary

- **Infrastructure in Docker:** PostgreSQL, ChromaDB, WAHA, and (optionally) the LLM service and backend — all defined in **`docker/docker-compose.yml`**.
- **Application code:** **`apps/backend`** is the Nemoris product server; **`apps/llm-service`** is the small proxy for OpenCode-based chat completions.
- **Together** they implement reminders, lists, memory over Chroma, and WhatsApp UX via WAHA, under the **Nemoris** name.
