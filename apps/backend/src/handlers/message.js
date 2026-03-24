import { prisma } from '../config/database.js';
import { sendWhatsAppMessage, getContact } from '../config/waha.js';
import { detectIntent, parseReminder, parseMemory, getResponseTemplates } from '../services/parser.js';
import { createReminder } from '../services/reminder.js';
import { storeMemory, retrieveRelevantMemories, getConversationHistory, storeMessage } from '../services/memory.js';
import { generateResponse, extractEntitiesWithLLM } from '../services/openai.js';
import { logger } from '../utils/logger.js';

const HUMAN_DELAY_MIN = 1000;
const HUMAN_DELAY_MAX = 4000;

function getRandomDelay() {
  return Math.floor(Math.random() * (HUMAN_DELAY_MAX - HUMAN_DELAY_MIN + 1)) + HUMAN_DELAY_MIN;
}

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    const phone = chatId.replace('@c.us', '').replace('@g.us', '');

    user = await prisma.user.create({
      data: { chatId, phone, name: userName },
    });
    logger.info(`New user registered: ${chatId}, name: ${userName}`);

    const t = getResponseTemplates('en');
    const welcomeMessage = t.welcome;
    await sendWhatsAppMessage(chatId, welcomeMessage);
  }

  const intent = detectIntent(text);
  const language = intent.language || 'en';
  const t = getResponseTemplates(language);

  logger.info(`Message from ${chatId}: "${text}" -> Intent: ${intent.intent}, Lang: ${language}`);

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

  let response = t.reminderSet.replace('{task}', parsed.task).replace('{time}', timeStr);

  if (parsed.recurrence) {
    const recText = t.reminderRecurrence.replace('{recurrence}', parsed.recurrence);
    response += recText;
  }

  return response;
}

async function handleMemory(userId, text, intent, language, t) {
  const parsed = parseMemory(text, language);

  try {
    const extracted = await extractEntitiesWithLLM(text, '', language);

    if (extracted.isMemory) {
      await storeMemory(userId, extracted.type || parsed.type, extracted.summary || text, {
        ...parsed.metadata,
        llm_extracted: extracted.entities,
        language,
      });

      if (extracted.summary) {
        return t.memoryStored.replace('{summary}', extracted.summary);
      }
      return t.memoryStoredDefault;
    }
  } catch (error) {
    logger.error('Error extracting memory with LLM:', error);
  }

  await storeMemory(userId, parsed.type, text, { ...parsed.metadata, language });

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

    const response = await generateResponse(text, relevantMemories, conversationHistory, language, null);
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
