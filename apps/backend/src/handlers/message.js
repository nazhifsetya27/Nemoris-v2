import { prisma } from '../config/database.js';
import {
  sendWhatsAppMessage,
  getContact,
  getPhoneNumberFromLid,
} from '../config/waha.js';
import {
  detectIntent,
  detectLanguage,
  tryIntentLexicalFastPath,
  scoreIntentHeuristic,
  parseReminder,
  parseMemory,
  getResponseTemplates,
} from '../services/parser.js';
import { createReminder } from '../services/reminder.js';
import {
  storeMemory,
  retrieveRelevantMemories,
  getConversationHistory,
  storeMessage,
} from '../services/memory.js';
import {
  generateResponse,
  extractEntitiesWithLLM,
  classifyIntentWithLLM,
} from '../services/openai.js';
import { getContext, setContext, inferContextFromResponse } from '../services/context.js';
import { logger } from '../utils/logger.js';

const HUMAN_DELAY_MIN = 1000;
const HUMAN_DELAY_MAX = 4000;

function getRandomDelay() {
  return (
    Math.floor(Math.random() * (HUMAN_DELAY_MAX - HUMAN_DELAY_MIN + 1)) +
    HUMAN_DELAY_MIN
  );
}

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 3-tier intent resolution:
 *   Tier 1: Lexical fast-path (regex, 0ms)
 *   Tier 2: Heuristic scoring + conversation context (0ms)
 *   Tier 3: LLM classification via local qwen2.5:3b (~200ms)
 */
async function resolveIntent(text, userId) {
  // Tier 1: Lexical fast-path (strong patterns)
  const fast = tryIntentLexicalFastPath(text);
  if (fast) return fast;

  // Tier 1b: Weaker lexical patterns with question guard
  const lexical = detectIntent(text);
  if (lexical) return { ...lexical, source: lexical.source || 'lexical' };

  // Tier 2: Heuristic scoring with conversation context
  const language = detectLanguage(text);
  const context = getContext(userId);
  const heuristic = scoreIntentHeuristic(text, language, context);
  if (heuristic) return heuristic;

  // Tier 3: LLM classification (local qwen2.5:3b, free)
  try {
    const maxHistory = parseInt(process.env.MESSAGE_HISTORY_LIMIT) || 5;
    const conversationHistory = await getConversationHistory(userId, maxHistory);

    const llmResult = await classifyIntentWithLLM(text, conversationHistory, language);
    if (llmResult) {
      return { intent: llmResult.intent, match: null, raw: text, language, source: llmResult.source };
    }
  } catch (error) {
    logger.warn('Tier 3 LLM classification failed, defaulting to question:', error.message);
  }

  // Default: question (safest fallback)
  return { intent: 'question', match: null, raw: text, language, source: 'default' };
}

/** Strip WhatsApp domain suffix; for @lid senders, resolve PN via WAHA when possible. */
async function resolvePhoneFromChatId(chatId) {
  let phone = chatId.replace(/@.+/, '');
  if (chatId.includes('@lid')) {
    try {
      const actualPn = await getPhoneNumberFromLid(chatId);
      if (actualPn) {
        logger.info(`Resolved LID ${chatId} to ${actualPn}`);
        phone = actualPn.replace(/@.+/, '');
      } else {
        logger.warn(`Failed to resolve LID ${chatId}, using stripped ID as phone.`);
      }
    } catch (error) {
      logger.error(`Error resolving LID ${chatId}:`, error);
    }
  }
  return phone;
}

export async function handleIncomingMessage(payload) {
  const { from, text } = payload;

  if (!from || !text) {
    logger.warn('Invalid message payload:', payload);
    return;
  }

  await delay(getRandomDelay());

  const chatId = from;
  let user = await prisma.user.findUnique({ where: { chatId } });

  if (!user) {
    const contactInfo = await getContact(chatId);
    const userName = contactInfo?.name || contactInfo?.pushName || null;
    const phone = await resolvePhoneFromChatId(chatId);

    user = await prisma.user.create({
      data: { chatId, phone, name: userName },
    });
    logger.info(`New user registered: ${chatId}, name: ${userName}`);

    const t = getResponseTemplates('en');
    const welcomeMessage = t.welcome;
    await sendWhatsAppMessage(chatId, welcomeMessage);
    await storeMessage(user.id, 'assistant', welcomeMessage);
    return;
  }

  const intent = await resolveIntent(text, user.id);
  logger.info(`Intent detected: ${intent.intent} (source: ${intent.source})`);

  const language = intent.language || 'en';
  logger.info(
    `Message from ${chatId}: "${text}" -> Intent: ${intent.intent}, Lang: ${language}, Source: ${intent.source || 'unknown'}`
  );
  const t = getResponseTemplates(language);

  await storeMessage(user.id, 'user', text);

  let response;

  switch (intent.intent) {
    case 'reminder':
      response = await handleReminder(user.id, text, intent, language, t);
      break;
    case 'memory':
      response = await handleMemory(user.id, text, intent, language, t);
      break;
    case 'question':
    default:
      response = await handleQuestion(user.id, text, language, t);
      break;
  }

  await storeMessage(user.id, 'assistant', response);

  // Update conversation context for next turn (Phase 3)
  const ctx = inferContextFromResponse(response, intent.intent, t);
  setContext(user.id, ctx);

  const shouldRespond = !['ping', 'PING', 'test', 'TEST'].includes(text.trim());
  if (shouldRespond) {
    await sendWhatsAppMessage(chatId, response);
  }
}

async function handleReminder(userId, text, intent, language, t) {
  const parsed = parseReminder(text, language);

  if (!parsed.task || !parsed.datetime) {
    return t.reminderError;
  }

  await createReminder(userId, parsed.task, parsed.datetime, parsed.recurrence);

  const timeStr = formatDateTime(parsed.datetime, language);

  let response = t.reminderSet
    .replace('{task}', parsed.task)
    .replace('{time}', timeStr);

  if (parsed.recurrence) {
    const recText = t.reminderRecurrence.replace('{recurrence}', parsed.recurrence);
    response += recText;
  }

  return response;
}

async function handleMemory(userId, text, _intent, language, t) {
  const parsed = parseMemory(text, language);

  try {
    const extracted = await extractEntitiesWithLLM(text, '', language);

    if (extracted.isMemory) {
      await storeMemory(
        userId,
        extracted.type || parsed.type,
        extracted.summary || text,
        {
          ...parsed.metadata,
          llm_extracted: extracted.entities,
          language,
        }
      );

      if (extracted.summary) {
        return t.memoryStored.replace('{summary}', extracted.summary);
      }
      return t.memoryStoredDefault;
    }
  } catch (error) {
    logger.error('Error extracting memory with LLM:', error);
  }

  await storeMemory(userId, parsed.type, text, {
    ...parsed.metadata,
    language,
  });

  return t.memoryStoredDefault;
}

async function handleQuestion(userId, text, language, t) {
  try {
    const maxMemories = parseInt(process.env.MAX_MEMORIES_RETRIEVED) || 3;
    const maxHistory = parseInt(process.env.MESSAGE_HISTORY_LIMIT) || 5;

    const [relevantMemories, conversationHistory] = await Promise.all([
      retrieveRelevantMemories(userId, text, maxMemories),
      getConversationHistory(userId, maxHistory),
    ]);

    if (relevantMemories.length > 0) {
      logger.info(`Found ${relevantMemories.length} relevant memories`);
    }

    const response = await generateResponse(
      text,
      relevantMemories,
      conversationHistory,
      language,
      null
    );
    return response;
  } catch (error) {
    logger.error('Error handling question:', error);
    return t.error;
  }
}

function formatDateTime(date, language = 'en') {
  const options = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  };

  if (language === 'id') {
    options.timeZone = 'Asia/Jakarta';
  }

  return date.toLocaleString(language === 'id' ? 'id-ID' : 'en-US', options);
}
