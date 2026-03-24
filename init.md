# Nemoris Setup Guide

## MacBook Air M1 with Colima

This guide walks you through setting up Nemoris on your MacBook Air M1 using Colima for Docker.

---

## Prerequisites

### 1. Install Homebrew

If you don't have Homebrew installed:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### 2. Install Docker CLI & Colima

```bash
brew install docker colima
```

### 3. Start Colima

```bash
colima start
```

Or with specific resources:

```bash
colima start --cpu 2 --memory 4 --disk 20
```

### 4. Verify Docker Works

```bash
docker ps
```

---

## Project Setup

### 1. Navigate to Project Directory

```bash
cd /Users/nazhifnugroho/Documents/Web-projects/nemoris
```

### 2. Copy Environment File

```bash
cp .env.example .env
```

### 3. Edit .env File

Open `.env` and add your OpenAI API key:

```bash
# OpenAI - Get your key from https://platform.openai.com/api-keys
OPENAI_API_KEY=sk-your-api-key-here
```

Optional: Change other settings if needed.

---

## Start Nemoris

### 1. Start All Services (Docker)

```bash
docker compose -f docker/docker-compose.yml --profile all up -d
```

Or use the helper script:

```bash
./scripts/start-all.sh
```

This will start:
- **nemoris_db** - PostgreSQL database (port 5442)
- **nemoris_chroma** - Vector database (port 8001)
- **nemoris_waha** - WhatsApp HTTP API (port 3002)
- **nemoris_backend** - Main application (port 3001)

**LLM Service:** Run on host (required for OpenCode):
```bash
npm run proxy
```

### 2. Start Individual Services (Profiles)

```bash
# Database only
docker compose -f docker/docker-compose.yml --profile db up -d

# Database + Chroma + WAHA (infrastructure)
docker compose -f docker/docker-compose.yml --profile db --profile chroma --profile waha up -d

# Full stack including backend
docker compose -f docker/docker-compose.yml --profile all up -d
```

### 3. Check Service Status

```bash
docker compose -f docker/docker-compose.yml ps
```

Or check logs:

```bash
docker compose -f docker/docker-compose.yml logs -f nemoris_backend
```

### 3. Verify Health

```bash
curl http://localhost:3001/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2026-03-16T...",
  "services": {
    "database": true,
    "chroma": true,
    "waha": true
  }
}
```

---

## Connect WhatsApp

### 1. Open WAHA Dashboard

Open your browser and go to:

```
http://localhost:3002
```

### 2. Login

- Default login credentials (change in production):
  - **Username**: admin
  - **Password**: admin

### 3. Connect WhatsApp

1. Go to **Sessions** tab
2. Click **Start** button on the default session
3. A QR code will appear
4. Open WhatsApp on your phone
5. Go to **Settings** → **Linked Devices**
6. Scan the QR code

### 4. Verify Connection

In WAHA dashboard, you should see the session status as "LOADED".

---

## Test Nemoris

### 1. Send a Test Message

Send a WhatsApp message to your connected number:

```
Hello
```

You should receive a welcome message from Nemoris.

### 2. Test Reminders

Try in English:
```
remind me to drink water at 6pm
```

Try in Indonesian:
```
ingatkan saya untuk minum air jam 7 malam
```

### 3. Test Memory

Try in English:
```
remember my birthday is December 25
```

Try in Indonesian:
```
ingat bahwa nama saya adalah John
```

### 4. Test Question

```
what is my birthday?
```

---

## Useful Commands

### View Logs

```bash
# All services
docker compose -f docker/docker-compose.yml logs -f

# Specific service
docker compose -f docker/docker-compose.yml logs -f nemoris_backend
docker compose -f docker/docker-compose.yml logs -f nemoris_waha
docker compose -f docker/docker-compose.yml logs -f nemoris_db
```

### Stop Services

```bash
./scripts/stop-all.sh
# or
docker compose -f docker/docker-compose.yml --profile all down
```

### Restart Services

```bash
docker compose -f docker/docker-compose.yml --profile all restart
```

### Remove Everything

```bash
docker compose -f docker/docker-compose.yml --profile all down
```

To also remove volumes (database and sessions will be wiped):

```bash
docker compose -f docker/docker-compose.yml --profile all down -v
```

### Rebuild After Code Changes

```bash
docker compose -f docker/docker-compose.yml build nemoris_backend
docker compose -f docker/docker-compose.yml up -d nemoris_backend
```

### Access PostgreSQL

```bash
# Connect to database
docker compose -f docker/docker-compose.yml exec nemoris_db psql -U nemoris -d nemoris

# Common commands
\d          # List tables
SELECT * FROM users;  # Query users
\q          # Quit
```

### Access Chroma

```bash
# Check Chroma API
curl http://localhost:8001/api/v1/version
```

### Local Development (without Docker)

```bash
# Terminal 1: LLM proxy
npm run proxy

# Terminal 2: Backend (requires Postgres, Chroma, WAHA running)
cd apps/backend && npm run dev
```

---

## Troubleshooting

### Colima Issues

```bash
# Restart Colima
colima stop
colima start

# Check Colima status
colima status
```

### Docker Issues

```bash
# Check Docker
docker info

# Restart Docker (if needed)
# System Preferences → General → More ... → Docker Desktop
```

### WAHA Not Connecting

1. Check if port 3002 is available:
   ```bash
   lsof -i :3002
   ```

2. Check WAHA logs:
   ```bash
   docker compose -f docker/docker-compose.yml logs nemoris_waha
   ```

3. Re-scan QR code:
   - Go to WAHA dashboard
   - Stop session
   - Start session again
   - Re-scan QR code

### Database Connection Error

1. Check if PostgreSQL is running:
   ```bash
   docker compose -f docker/docker-compose.yml ps nemoris_db
   ```

2. Check logs:
   ```bash
   docker compose -f docker/docker-compose.yml logs nemoris_db
   ```

3. Wait a bit and try again - database might still be starting up

### Nemoris Not Responding

1. Check backend logs:
   ```bash
   docker compose -f docker/docker-compose.yml logs nemoris_backend
   ```

2. Verify health endpoint:
   ```bash
   curl http://localhost:3001/health
   ```

3. Ensure LLM proxy is running on host (for OpenCode):
   ```bash
   npm run proxy
   ```

---

## Project Structure

```
nemoris/
├── apps/
│   ├── backend/              # nemoris_backend
│   │   ├── src/
│   │   │   ├── index.js      # Main entry point
│   │   │   ├── config/       # database, chroma, waha
│   │   │   ├── services/     # parser, reminder, memory, openai
│   │   │   ├── handlers/
│   │   │   └── routes/
│   │   ├── prisma/
│   │   ├── package.json
│   │   └── Dockerfile
│   └── llm-service/          # nemoris_llm_service (OpenCode proxy)
│       ├── src/index.js
│       ├── package.json
│       └── Dockerfile
├── docker/
│   ├── docker-compose.yml    # All services with profiles
│   └── .env.docker
├── scripts/
│   ├── start-all.sh
│   └── stop-all.sh
├── package.json              # Root scripts
└── .env
```

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/webhook` | POST | WAHA webhook receiver |
| `/api/send` | POST | Send WhatsApp message |
| `/api/queue/status` | GET | Message queue status |
| `/api/users/:chatId` | GET | Get user info |
| `/api/users/:chatId/reminders` | GET | Get user reminders |
| `/api/users/:chatId/memories` | GET | Get user memories |

---

## WhatsApp Ban Prevention Tips

1. **Don't send too many messages too fast** - Nemoris has a built-in queue with delays (3-8 seconds between messages)

2. **Use the number for legitimate purposes** - Don't use for marketing or spam

3. **Warm up the number** - Use it normally for a few days before heavy automation

4. **Keep responses natural** - Avoid repetitive patterns

5. **Monitor for warnings** - WhatsApp may send warnings before banning

---

## Next Steps

- [ ] Set up production environment variables
- [ ] Configure WAHA authentication
- [ ] Add more languages support
- [ ] Set up monitoring/logging
- [ ] Configure backup for database

---

## Support

If you encounter issues:

1. Check logs: `docker compose -f docker/docker-compose.yml logs -f`
2. Verify all services are running: `docker compose -f docker/docker-compose.yml ps`
3. Check health: `curl http://localhost:3001/health`
4. Ensure LLM proxy is running: `npm run proxy`
5. Review this guide again

---

## Using OpenCode as LLM Provider (Optional)

Nemoris can connect to OpenCode instead of OpenAI for LLM capabilities.

### Option 1: OpenCode Proxy (Recommended)

This allows Nemoris to use OpenCode's authenticated Google/Antigravity models.

#### Step 1: Install Dependencies

```bash
npm install cors axios
```

#### Step 2: Configure OpenCode

1. Authenticate with Google:
```bash
opencode auth login
```

2. Test a model:
```bash
opencode run "hi" --model=google/gemini-2.5-flash
```

#### Step 3: Start OpenCode Proxy

```bash
# Terminal 1: Start the LLM service (required when using Docker for backend)
npm run proxy
```

The proxy runs on port 4096 by default.

#### Step 4: Configure Nemoris

Edit `.env`:
```bash
LLM_PROVIDER=opencode
LLM_URL=http://localhost:4096
OPENAI_MODEL=google/gemini-2.5-flash
```

For Docker: Backend uses `host.docker.internal:4096` by default to reach the host proxy.

#### Step 5: Restart Backend

```bash
docker compose -f docker/docker-compose.yml build nemoris_backend
docker compose -f docker/docker-compose.yml up -d nemoris_backend
```

### Available Models

Through OpenCode (Google provider):
- `google/gemini-2.5-flash` (fast, recommended)
- `google/gemini-2.5-pro` (more capable)

Note: Antigravity Claude models (opus, sonnet) require special access and may show "Requested entity was not found" errors.

### Troubleshooting OpenCode

```bash
# Check if opencode is installed
opencode --version

# Re-authenticate
rm ~/.local/share/opencode/antigravity-accounts.json
opencode auth login

# Test model directly
opencode run "hello" --model=google/gemini-2.5-flash
```
