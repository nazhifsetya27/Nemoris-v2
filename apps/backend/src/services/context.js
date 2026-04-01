/**
 * Per-user conversation context cache (in-memory, TTL-based).
 * Tracks what the bot just did so follow-up messages can be classified correctly.
 */

const CONTEXT_TTL = 5 * 60 * 1000; // 5 minutes
const CLEANUP_INTERVAL = 10 * 60 * 1000; // 10 minutes

/** @type {Map<string, { lastBotAction: string, pendingSlot: string|null, lastIntent: string|null, updatedAt: number }>} */
const contextCache = new Map();

// Periodic cleanup of expired entries
setInterval(() => {
  const now = Date.now();
  for (const [key, ctx] of contextCache) {
    if (now - ctx.updatedAt > CONTEXT_TTL) {
      contextCache.delete(key);
    }
  }
}, CLEANUP_INTERVAL);

/**
 * Get conversation context for a user. Returns null if expired or not set.
 */
export function getContext(userId) {
  const ctx = contextCache.get(userId);
  if (!ctx) return null;
  if (Date.now() - ctx.updatedAt > CONTEXT_TTL) {
    contextCache.delete(userId);
    return null;
  }
  return ctx;
}

/**
 * Set conversation context after bot responds.
 */
export function setContext(userId, data) {
  contextCache.set(userId, {
    ...data,
    updatedAt: Date.now(),
  });
}

/**
 * Analyze bot response to determine context for next turn.
 * @param {string} response - the bot's response text
 * @param {string} intent - the intent that was just handled
 * @param {object} templates - response templates for the current language
 */
export function inferContextFromResponse(response, intent, templates) {
  // Bot sent reminder error → user might follow up with time
  if (response === templates.reminderError || response === templates.clarification) {
    return { lastBotAction: 'reminder_error', pendingSlot: 'reminder_time', lastIntent: 'reminder' };
  }

  // Bot stored a memory
  if (response === templates.memoryStoredDefault || response.startsWith('✅')) {
    return { lastBotAction: 'stored_memory', pendingSlot: null, lastIntent: 'memory' };
  }

  // Bot asked for info (heuristic: response contains "?" and asks about user's info)
  const askedInfo = /(?:bisa.*beritahu|bisa.*kasih tahu|could you tell|can you tell|siapa|apa|what is|who is)/i;
  if (askedInfo.test(response) && response.includes('?')) {
    return { lastBotAction: 'asked_info', pendingSlot: 'person_name', lastIntent: 'question' };
  }

  return { lastBotAction: 'general_response', pendingSlot: null, lastIntent: intent };
}
