# LLM Service - OpenCode proxy
# Note: Requires opencode CLI installed. For host-only usage, run: npm run proxy
FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source
COPY src ./src/

EXPOSE 4096

CMD ["npm", "start"]
