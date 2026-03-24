# Nemoris - Personal AI Memory Assistant

> Your personal AI that remembers everything and reminds you when it matters.

---

## Table of Contents

- [Overview](#overview)
- [Technology Stack](#technology-stack)
- [Architecture](#architecture)
- [Database Schema](#database-schema)
- [Core Features](#core-features)
- [API Endpoints](#api-endpoints)
- [Project Structure](#project-structure)
- [Implementation Phases](#implementation-phases)
- [Pros \& Cons](#pros--cons)
- [Estimated Costs](#estimated-costs)

---

## Overview

Nemoris is a personal AI assistant that lives in WhatsApp and remembers everything the user tells it. It can:

- 📝 **Remember facts** - "My marriage date is May 27, 2000"
- ⏰ **Set reminders** - "Remind me to pay the bill today at 3 PM"
- 📋 **Manage tasks** - "Remind me to fill the questionnaire tomorrow morning"
- 💬 **Chat naturally** - Answer questions based on stored memories

### Key Requirements

| Requirement | Implementation |
|-------------|----------------|
| Multi-user support | Single WAHA session, isolated by chatId |
| No cross-context memory | Each user has separate database records |
| WhatsApp-only interaction | WAHA as message delivery |
| Docker containerization | All services in docker-compose |

---

## Technology Stack

| Component | Technology | Version | Justification |
|-----------|------------|---------|----------------|
| **Language** | JavaScript (Node.js) | 20.x | Your preference |
| **Framework** | Express.js | ^4.18 | Lightweight, bot-friendly |
| **WhatsApp** | WAHA | Latest | Self-hosted, single session |
| **Database** | PostgreSQL | 15+ | Your choice |
| **Vector DB** | Chroma | Latest | Beginner-friendly |
| **ORM** | Prisma | ^5.0 | Easy PostgreSQL handling |
| **LLM** | OpenAI GPT-4o | - | Easy integration |
| **Scheduler** | node-cron | ^3.0 | Reminder scheduling |
| **Container** | Docker | Latest | Your requirement |

### Why PostgreSQL + Chroma?

```
┌─────────────────────────────────────────────────────────────────┐
│                    Storage Options                              │
├──────────────────────┬──────────────────────────────────────────┤
│ PostgreSQL + pgvector │ • Single database for everything        │
│                      │ • Good for simple vector similarity      │
│                      │ • Easier maintenance                     │
├──────────────────────┼──────────────────────────────────────────┤
│ PostgreSQL + Chroma   │ • Richer vector features                │
│ (CHOSEN)             │ • Better scaling                         │
│                      │ • More flexible queries                  │
│                      │ • Easier to learn                        │
└──────────────────────┴──────────────────────────────────────────┘
```

---

## Architecture

### High-Level System Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Nemoris System                             │
│                                                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐   │
│  │   WhatsApp   │    │    WAHA      │    │      Nemoris         │   │
│  │   Users      │◄───►│  (Session)   │◄──►│      Backend        │   │
│  │              │    │   (Docker)   │    │   (Express + JS)    │   │
│  └──────────────┘    └──────────────┘    └──────────┬───────────┘   │
│                                                      │               │
│              ┌───────────────────────────────────────┼───────────────┤
│              │                                       │               │
│              ▼                                       ▼               │
│       ┌──────────────┐                       ┌──────────────┐       │
│       │ PostgreSQL   │                       │    Chroma    │       │
│       │              │                       │  (Vector DB) │       │
│       │ • users      │                       │              │       │
│       │ • memories   │                       │ • embeddings │       │
│       │ • reminders  │                       │ • similarity │       │
│       │ • messages   │                       │   search     │       │
│       └──────────────┘                       └──────────────┘       │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Message Flow

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   WhatsApp      │      │      WAHA       │      │    Nemoris      │
│   User         │      │    Session      │      │    Backend      │
└────────┬────────┘      └────────┬────────┘      └────────┬────────┘
         │                        │                        │
         │  Send Message          │                        │
         │──────────────────────►│  Webhook              │
         │                        │──────────────────────►│
         │                        │                        │
         │                        │                   ┌────┴────┐
         │                        │                   │ Identify │
         │                        │                   │  User   │
         │                        │                   └────┬────┘
         │                        │                        │
         │                        │                   ┌────┴────┐
         │                        │                   │ Intent  │
         │                        │                   │Routing  │
         │                        │                   └────┬────┘
         │                        │                        │
         │                        │           ┌───────────┼───────────┐
         │                        │           │           │           │
         │                        │      ┌────┴───┐ ┌────┴───┐ ┌────┴───┐
         │                        │      │Memory  │ │Reminder│ │  LLM   │
         │                        │      │ Store  │ │Schedule│ │Response│
         │                        │      └────┬───┘ └────┬───┘ └────┬───┘
         │                        │           │           │           │
         │                        │           └───────────┼───────────┘
         │                        │                       │
         │                        │               ┌───────┴───────┐
         │                        │               │ Send Response │
         │                        │               │   via WAHA    │
         │                        │               └───────┬───────┘
         │                        │                       │
         │  Receive Response      │                       │
         │◄───────────────────────│◄──────────────────────│
         │                        │                       │
```

### Multi-User Isolation

```
┌─────────────────────────────────────────────────────────────────┐
│                    WAHA Single Session                          │
│                                                                  │
│  User A (chatId: 6281234567890@c.us)                           │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Memory: "birthday: May 27, 2000"                        │   │
│  │  Memory: "likes: coffee without sugar"                   │   │
│  │  Reminders: [...]                                        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│  User B (chatId: 6289876543210@c.us)                           │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Memory: "wedding: December 15, 2023"                     │   │
│  │  Memory: "allergic to: shellfish"                         │   │
│  │  Reminders: [...]                                        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│  User C (chatId: 6285555555555@c.us)                           │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Memory: [...]                                           │   │
│  │  Reminders: [...]                                        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ✅ Each user has completely isolated memory                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### Entity Relationship Diagram

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│    users    │       │  memories   │       │  reminders  │
├─────────────┤       ├─────────────┤       ├─────────────┤
│ id (PK)     │◄──┐   │ id (PK)     │       │ id (PK)     │
│ chat_id     │   │   │ user_id (FK)│◄──┐   │ user_id (FK)│◄──┐
│ phone       │   └───│ type        │   │   │ task        │   │
│ name        │       │ content     │   └───│ scheduled_at│   │
│ settings    │       │ embedding_id│       │ sent        │   │
│ created_at  │       │ metadata    │       │ created_at  │   │
└─────────────┘       │ created_at  │       └─────────────┘   │
                      └─────────────┘                        │
                              │                                │
                              ▼                                │
                      ┌─────────────┐                        │
                      │  chroma_    │                        │
                      │  embeddings │                        │
                      │  collection │                        │
                      └─────────────┘                        │
```

### Table Definitions

#### users

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, DEFAULT | Unique user ID |
| `chat_id` | VARCHAR(50) | UNIQUE, NOT NULL | WhatsApp chatId (e.g., 6281234567890@c.us) |
| `phone` | VARCHAR(20) | NOT NULL | Phone number |
| `name` | VARCHAR(100) | NULLABLE | User's display name |
| `settings` | JSONB | DEFAULT '{}' | User preferences |
| `created_at` | TIMESTAMP | DEFAULT NOW | Registration time |
| `updated_at` | TIMESTAMP | DEFAULT NOW | Last update |

#### memories

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, DEFAULT | Unique memory ID |
| `user_id` | UUID | FK → users.id | Owner |
| `type` | VARCHAR(20) | NOT NULL | 'fact', 'preference', 'event', 'conversation' |
| `content` | TEXT | NOT NULL | Raw memory text |
| `chroma_id` | VARCHAR(100) | NULLABLE | Chroma embedding reference |
| `metadata` | JSONB | DEFAULT '{}' | Extracted entities |
| `importance` | INTEGER | DEFAULT 1 | Memory importance (1-5) |
| `created_at` | TIMESTAMP | DEFAULT NOW | When stored |

#### reminders

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, DEFAULT | Unique reminder ID |
| `user_id` | UUID | FK → users.id | Owner |
| `task` | TEXT | NOT NULL | What to remind |
| `scheduled_at` | TIMESTAMP | NOT NULL | When to send |
| `recurrence` | VARCHAR(20) | NULLABLE | 'daily', 'weekly', 'monthly', NULL |
| `sent` | BOOLEAN | DEFAULT FALSE | Sent status |
| `sent_at` | TIMESTAMP | NULLABLE | When sent |
| `created_at` | TIMESTAMP | DEFAULT NOW | When created |

#### messages

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, DEFAULT | Unique message ID |
| `user_id` | UUID | FK → users.id | Owner |
| `role` | VARCHAR(10) | NOT NULL | 'user' or 'assistant' |
| `content` | TEXT | NOT NULL | Message content |
| `created_at` | TIMESTAMP | DEFAULT NOW | When sent |

---

## Core Features

### 1. Intent Detection & Routing

```
User Message
     │
     ▼
┌─────────────────┐
│  Regex Patterns │──────┐
└─────────────────┘      │
                          ▼
            ┌─────────────────────┐
            │   Intent Detection  │
            └─────────────────────┘
                          │
     ┌────────────────────┼────────────────────┐
     │                    │                    │
     ▼                    ▼                    ▼
┌─────────┐        ┌────────────┐        ┌─────────┐
│Reminder │        │   Memory   │        │Question │
│ "remind"│        │"remember"  │        │  Other  │
└────┬────┘        └─────┬──────┘        └────┬────┘
     │                   │                     │
     ▼                   ▼                     ▼
┌─────────┐        ┌────────────┐        ┌─────────┐
│  Parse  │        │   Store    │        │   RAG   │
│datetime │        │  to Chroma │        │  + LLM  │
│ + task  │        │            │        │         │
└────┬────┘        └─────┬──────┘        └────┬────┘
     │                   │                     │
     ▼                   ▼                     ▼
┌─────────┐        ┌────────────┐        ┌─────────┐
│Schedule │        │  Confirm   │        │Response │
│Reminder │        │  Stored    │        │  with   │
│         │        │            │        │ Memory  │
└─────────┘        └────────────┘        └─────────┘
```

### 2. Reminder Extraction Patterns

| Pattern | Example | Extracted |
|---------|---------|-----------|
| `remind me to [task] at [time]` | "remind me to pay bill at 3pm" | task: "pay bill", time: "15:00" |
| `remind me [date] at [time]` | "remind me tomorrow at 9am" | task: ?, time: "tomorrow 9am" |
| `remind me to [task] [date]` | "remind me to fill questionnaire tomorrow morning" | task: "fill questionnaire", date: "tomorrow morning" |
| `remember [event]: [date]` | "remember my marriage date: 27 may 2000" | event: "marriage date", date: "May 27, 2000" |

### 3. Memory Types

| Type | Example | Storage | Retrieval |
|------|---------|---------|-----------|
| **Fact** | "My birthday is May 27, 2000" | PostgreSQL + Chroma | Semantic search |
| **Preference** | "I prefer coffee without sugar" | PostgreSQL + Chroma | Semantic search |
| **Event** | "Meeting with John tomorrow" | PostgreSQL + Chroma | Semantic search |
| **Conversation** | Chat history | PostgreSQL | Last N messages |

### 4. RAG Pipeline for Q&A

```
User Question
     │
     ▼
┌─────────────────┐
│  Embed Query    │──── OpenAI text-embedding-3-small
│  (1536 dims)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Chroma Search  │──── Similarity: top 5 memories
│  (top_k = 5)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Build Prompt    │──── System: "You are Nemoris, a helpful assistant..."
│                 │    Context: {retrieved_memories}
│                 │    User: {question}
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  LLM Generate   │──── GPT-4o response
│                 │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Save Message   │──── To messages table
│  to History     │
└─────────────────┘
```

---

## API Endpoints

### WAHA Webhook

```
POST /webhook
Content-Type: application/json

{
  "session": "default",
  "event": "message",
  "payload": {
    "id": "false_6281234567890@c.us_ABC123",
    "from": "6281234567890@c.us",
    "fromMe": false,
    "text": "remind me to pay bill at 3pm",
    "timestamp": 1699999999
  }
}

Response: 200 OK
```

### Send Message (Internal)

```
POST /api/send
Content-Type: application/json
Authorization: Bearer <internal_token>

{
  "chatId": "6281234567890@c.us",
  "text": "I've set a reminder for you to pay the bill at 3:00 PM today."
}

Response: { "success": true, "messageId": "..." }
```

### Health Check

```
GET /health

Response: {
  "status": "ok",
  "timestamp": "2026-03-16T12:00:00Z",
  "services": {
    "database": "connected",
    "chroma": "connected",
    "waha": "connected"
  }
}
```

---

## Project Structure

```
nemoris/
├── docker-compose.yml          # All services orchestration
├── Dockerfile                   # Nemoris Node.js app
├── .env.example                 # Environment template
├── package.json                 # Dependencies
├── prisma/
│   └── schema.prisma           # Database schema
├── src/
│   ├── index.js                 # Entry point
│   ├── config/
│   │   ├── database.js          # PostgreSQL connection
│   │   ├── chroma.js            # Chroma client
│   │   └── waha.js              # WAHA API config
│   ├── services/
│   │   ├── whatsapp.js          # WAHA message sending
│   │   ├── openai.js            # OpenAI LLM integration
│   │   ├── memory.js            # Memory storage & retrieval
│   │   ├── reminder.js          # Reminder scheduler
│   │   └── parser.js            # Intent & entity extraction
│   ├── handlers/
│   │   └── message.js           # Main message handler
│   ├── routes/
│   │   ├── webhook.js           # WAHA webhook receiver
│   │   └── api.js               # Internal API routes
│   ├── middleware/
│   │   └── errorHandler.js      # Error handling
│   └── utils/
│       ├── logger.js             # Logging utility
│       └── dateParser.js        # Date/time parsing
├── scripts/
│   └── wait-for.sh              # Docker wait script
└── README.md                    # This file
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1)

| Day | Task | Deliverable |
|-----|------|-------------|
| 1 | Setup project structure & Docker compose | docker-compose.yml with all services |
| 2 | Configure PostgreSQL with Prisma | schema.prisma, connection tested |
| 3 | Setup Chroma client | Chroma connection verified |
| 4 | Basic Express server | /health endpoint working |
| 5 | WAHA integration | Can send/receive messages |

**Milestone**: Basic Express server that can receive WAHA webhooks

---

### Phase 2: User Management (Week 1-2)

| Day | Task | Deliverable |
|-----|------|-------------|
| 6 | Auto-register users on first message | New users created in DB |
| 7 | User context loading | chatId → user data |
| 8 | Message history storage | messages table populated |
| 9 | Basic user settings | JSONB settings work |

**Milestone**: Users are registered and messages are stored

---

### Phase 3: Reminders (Week 2)

| Day | Task | Deliverable |
|-----|------|-------------|
| 10 | Intent parser for reminders | Detect "remind me" phrases |
| 11 | Date/time extraction | Parse "today at 3pm", "tomorrow morning" |
| 12 | Reminder storage | reminders table populated |
| 13 | Cron job scheduler | Check reminders every minute |
| 14 | Send reminder via WAHA | User receives reminder message |
| 15 | Recurrence support | daily, weekly, monthly reminders |

**Milestone**: Users can set reminders and receive them

---

### Phase 4: Memory System (Week 2-3)

| Day | Task | Deliverable |
|-----|------|-------------|
| 16 | Intent parser for memory | Detect "remember that", "my ... is" |
| 17 | Entity extraction | Extract facts from messages |
| 18 | Chroma embedding storage | Memories stored as vectors |
| 19 | Semantic search | Retrieve similar memories |
| 20 | RAG pipeline | Full question-answering flow |
| 21 | Memory confirmation | "I've remembered that..." |

**Milestone**: System remembers and can recall user facts

---

### Phase 5: Polish (Week 3)

| Day | Task | Deliverable |
|-----|------|-------------|
| 22 | Error handling | Graceful error responses |
| 23 | Rate limiting | Prevent spam/abuse |
| 24 | Logging | Structured logging |
| 25 | Testing | Unit & integration tests |
| 26 | Documentation | API docs, README |
| 27 | Deployment | Production-ready docker setup |

**Milestone**: Production-ready application

---

## Pros & Cons

### ✅ Pros

| Aspect | Detail |
|--------|--------|
| **Proven Concept** | Similar to Memorae, Manvi (existing GitHub projects) - fully achievable |
| **Beginner-Friendly** | Chroma has excellent docs, Prisma makes DB easy |
| **Cost-Effective** | Self-hosted WAHA + cheap PostgreSQL, ~$30-90/month |
| **Single Session** | One WAHA session handles unlimited users |
| **Flexible** | PostgreSQL handles structured data well |
| **Scalable** | Can add more users by upgrading VPS |
| **No Cross-Context** | Clean isolation per user via chatId |

### ⚠️ Challenges (with Solutions)

| Challenge | Reality | Solution |
|-----------|---------|----------|
| **WhatsApp Bans** | WAHA can get numbers banned | Use fresh number, warm up gradually, consider business API later |
| **LLM Costs** | Memory retrieval adds token usage | Use GPT-4o-mini for extraction, implement caching |
| **Reminder Reliability** | Cron jobs can miss if server restarts | Add health check monitoring, use database-backed scheduling |
| **Intent Parsing** | Free-form input is hard | Start with regex patterns, enhance with LLM for complex cases |
| **Date Parsing** | Natural language dates vary | Use libraries like chrono-node |
| **Embedding Costs** | Storing vectors adds overhead | Batch embeddings, use smaller models |

---

## Estimated Costs

### For 50 Users

| Service | Tier | Monthly Cost | Notes |
|---------|------|-------------|-------|
| **VPS** | 2 CPU, 4GB RAM | $10/mo | Runs WAHA + App + DB |
| **PostgreSQL** | Atlas Free Tier | $0 | Up to 512MB |
| **Chroma** | Local (in Docker) | $0 | No additional cost |
| **OpenAI** | GPT-4o-mini | $20-50/mo | ~1000 messages/user/month |
| **WAHA** | Free Core | $0 | Single session free |
| **Total** | | **~$30-60/mo** | |

### Cost Breakdown by Scale

| Users | Estimated Monthly Cost |
|-------|----------------------|
| 10 | $15-25/mo |
| 50 | $30-60/mo |
| 100 | $50-100/mo |
| 500 | $100-200/mo |

---

## Quick Start (When Ready)

```bash
# 1. Clone and setup
cp .env.example .env
# Edit .env with your values

# 2. Start all services
docker-compose up -d

# 3. Check logs
docker-compose logs -f nemoris

# 4. Setup WhatsApp
# Open WAHA dashboard at http://localhost:3000
# Scan QR code with your WhatsApp

# 5. Test
# Send "remind me to test at 3pm" to your WhatsApp
```

---

## Roadmap Beyond MVP

- [ ] Voice message support
- [ ] Image/attachment memory
- [ ] Calendar integration (Google Calendar)
- [ ] Multi-language support
- [ ] Dashboard for users to manage memories
- [ ] Analytics (most common reminders, etc.)
- [ ] Web interface alternative to WhatsApp
- [ ] Shared memories (family/group)

---

## References

- [WAHA Documentation](https://waha.devlike.pro/)
- [Chroma Getting Started](https://docs.trychroma.com/)
- [OpenAI API](https://platform.openai.com/docs)
- [Prisma Documentation](https://www.prisma.io/docs)
- [node-cron](https://www.npmjs.com/package/node-cron)
- [Similar Project: Manvi](https://github.com/viswabnath/whatsapp-reminder-bot)

---

*Built with ❤️ for people who want to remember everything.*
