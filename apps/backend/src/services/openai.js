import OpenAI from 'openai';
import { logger } from '../utils/logger.js';

const LLM_PROVIDER = process.env.LLM_PROVIDER || 'openai';
const LLM_URL = process.env.LLM_URL || 'http://localhost:11434';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'not-needed';
const OLLAMA_CLOUD_API_KEY = process.env.OLLAMA_CLOUD_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

let openai;
let embeddingModel = EMBEDDING_MODEL;

function initOpenAI() {
  if (LLM_PROVIDER === 'local' || LLM_PROVIDER === 'ollama' || LLM_PROVIDER === 'lmstudio' || LLM_PROVIDER === 'opencode') {
    openai = new OpenAI({
      apiKey: 'not-needed',
      baseURL: `${LLM_URL}/v1`,
    });
  } else if (LLM_PROVIDER !== 'ollama-cloud') {
    openai = new OpenAI({
      apiKey: OPENAI_API_KEY,
    });
  }
}

initOpenAI();

/** Ollama Cloud uses native /api/chat (not OpenAI-compatible). */
async function ollamaCloudChat(messages, model, maxTokens = 200) {
  const response = await fetch('https://api.ollama.com/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OLLAMA_CLOUD_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: { num_predict: maxTokens, temperature: 0.7 },
    }),
  });
  if (!response.ok) {
    throw new Error(`Ollama Cloud ${response.status}: ${await response.text()}`);
  }
  const data = await response.json();
  return data.message?.content || '';
}

export const DEFAULT_MODEL = OPENAI_MODEL;
export const IS_LOCAL = !['openai', 'google', 'ollama-cloud'].includes(LLM_PROVIDER);

const SYSTEM_PROMPTS = {
  en: {
    extraction: `Extract info from user message. Types: fact, preference, event.
Response JSON: {"type":"fact|preference|event","entities":{},"isMemory":true|false,"summary":"brief summary"}`,
    response: `You are Nemoris, a personal AI memory assistant on WhatsApp. You are an AI, not a person — you have no family, feelings, or personal experiences.
You store and recall things the USER tells you. Memories below belong to the USER, not you. When the user asks "who is my X?", answer about THEIR X. When the user asks about YOU, remind them you are an AI named Nemoris. Never reveal your model name, architecture, or who trained you.
If no relevant memory exists, say you don't have that info yet and ask the user to tell you.
If the user asks something unrelated to memory or personal info (e.g. coding, creating files, general knowledge), politely say you are a memory assistant and can only help remember personal information.
Rules: Be concise and warm. Keep replies short (1-2 sentences max). Do NOT ask follow-up questions unless the user's message is unclear. Do NOT suggest topics or steer the conversation. Only respond to what the user said.
Format: Plain text only, no markdown, no asterisks, no bullet points. Emojis are OK but use sparingly — max 1 per message, only when it adds warmth.`,
  },
  id: {
    extraction: `Ekstrak informasi dari pesan pengguna. Tipe: fact, preference, event.
Response JSON: {"type":"fact|preference|event","entities":{},"isMemory":true|false,"summary":"ringkasan singkat"}`,
    response: `Kamu adalah Nemoris, asisten AI memory personal di WhatsApp. Kamu adalah AI, bukan manusia — kamu tidak punya keluarga, perasaan, atau pengalaman pribadi.
Kamu menyimpan dan mengingat hal-hal yang diberitahu PENGGUNA. Memori di bawah milik PENGGUNA, bukan milik kamu. Jika pengguna bertanya "siapa X saya?", jawab tentang X MEREKA. Jika pengguna bertanya tentang KAMU, ingatkan bahwa kamu adalah AI bernama Nemoris. Jangan pernah ungkapkan nama model, arsitektur, atau siapa yang melatihmu.
Jika tidak ada memori yang relevan, katakan kamu belum punya info tersebut dan minta pengguna memberitahu.
Jika pengguna bertanya hal yang tidak terkait memori atau info personal (misalnya coding, membuat file, pengetahuan umum), katakan dengan sopan bahwa kamu adalah asisten memory dan hanya bisa membantu mengingat informasi personal.
Aturan: Singkat dan hangat. Jawab maksimal 1-2 kalimat. JANGAN ajukan pertanyaan lanjutan kecuali pesan pengguna tidak jelas. JANGAN menyarankan topik atau mengarahkan percakapan. Hanya tanggapi apa yang pengguna katakan.
Format: Teks biasa saja, tanpa markdown, tanpa asterisk, tanpa bullet point. Emoji boleh tapi hemat — maksimal 1 per pesan, hanya kalau menambah kesan hangat.`,
  },
};

const INTENT_CLASSIFIER_PROMPTS = {
  en: `You classify the user's latest WhatsApp message for Nemoris (reminders, memory storage, or general chat).

Intents:
- reminder: user wants a time-based alert or recurring nudge, OR a short follow-up that completes scheduling (e.g. only a time or date after Nemoris asked for details or gave reminderError).
- memory: user wants to store a fact, preference, or note for later recall (not a scheduled alert).
- question: general chat, asking for information, or anything that is not clearly reminder or memory.

Use the full conversation transcript. Output ONLY valid JSON: {"intent":"reminder"|"memory"|"question"}`,
  id: `Anda mengklasifikasi pesan WhatsApp terbaru pengguna untuk Nemoris (pengingat, penyimpanan memori, atau obrolan umum).

Maksud:
- reminder: ingin pemberitahuan berbasis waktu atau pengulangan, ATAU balasan singkat yang melengkapi jadwal (misalnya hanya jam/tanggal setelah Nemoris meminta detail atau menolak format pengingat).
- memory: ingin menyimpan fakta, preferensi, atau catatan untuk diingat nanti (bukan jadwal alarm).
- question: obrolan umum, bertanya informasi, atau yang tidak jelas sebagai reminder/memory.

Gunakan transkrip percakapan. Hanya JSON valid: {"intent":"reminder"|"memory"|"question"}`,
};

const responseCache = new Map();
const MAX_CACHE_SIZE = 100;
const CACHE_TTL = 5 * 60 * 1000;

function getCacheKey(text, memories) {
  const memHash = memories.slice(0, 3).sort().join('|');
  return `${text.slice(0, 50)}:${memHash.slice(0, 30)}`;
}

function getCachedResponse(key) {
  const cached = responseCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.response;
  }
  return null;
}

function setCachedResponse(key, response) {
  if (responseCache.size >= MAX_CACHE_SIZE) {
    const firstKey = responseCache.keys().next().value;
    responseCache.delete(firstKey);
  }
  responseCache.set(key, { response, timestamp: Date.now() });
}

export async function generateEmbedding(text) {
  if (LLM_PROVIDER === 'local' || LLM_PROVIDER === 'ollama' || LLM_PROVIDER === 'ollama-cloud') {
    try {
      const response = await fetch(`${LLM_URL}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'nomic-embed-text',
          prompt: text.slice(0, 8000),
        }),
      });
      const data = await response.json();
      if (data.embedding) return data.embedding;
    } catch (error) {
      logger.warn('Embedding model not available, skipping');
    }
    return null;
  }

  if (OPENAI_API_KEY && OPENAI_API_KEY !== 'your-openai-api-key-here') {
    try {
      const openaiForEmbeddings = new OpenAI({ apiKey: OPENAI_API_KEY });
      const response = await openaiForEmbeddings.embeddings.create({
        model: 'text-embedding-3-small',
        input: text.slice(0, 8000),
      });
      return response.data[0].embedding;
    } catch (error) {
      logger.warn('OpenAI embedding failed, skipping');
    }
  }

  return null;
}

async function chatCompletionLocal(messages, model, maxTokens = 500) {
  try {
    if (LLM_PROVIDER === 'ollama-cloud') {
      return await ollamaCloudChat(messages, model, maxTokens);
    }
    const response = await openai.chat.completions.create({
      model: model,
      messages: messages,
      temperature: 0.7,
      max_tokens: maxTokens,
    });
    return response.choices[0].message.content;
  } catch (error) {
    logger.error('Error in chat completion:', error);
    throw error;
  }
}

export async function chatCompletion(messages, model = DEFAULT_MODEL, maxTokens = 500) {
  if (LLM_PROVIDER !== 'openai') {
    return chatCompletionLocal(messages, model, maxTokens);
  }

  try {
    const response = await openai.chat.completions.create({
      model: model,
      messages: messages,
      temperature: 0.7,
      max_tokens: maxTokens,
    });
    return response.choices[0].message.content;
  } catch (error) {
    console.error('Error in chat completion:', error);
    throw error;
  }
}

function parseJsonIntentResponse(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const cleaned = raw
      .replace(/^\s*```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    const intent = parsed.intent;
    if (intent === 'reminder' || intent === 'memory' || intent === 'question') {
      return { intent };
    }
  } catch {
    // invalid JSON or shape
  }
  return null;
}

/**
 * Classify user intent using recent conversation + latest message (for ambiguous / follow-up text).
 * @param {string} text
 * @param {{ role: string, content: string }[]} conversationHistory oldest-first (excludes current message)
 * @param {string} language hint 'en' | 'id'
 * @returns {Promise<{ intent: string, source: string } | null>}
 */
export async function classifyIntentWithLLM(
  text,
  conversationHistory = [],
  language = 'en'
) {
  const systemPrompt =
    INTENT_CLASSIFIER_PROMPTS[language] || INTENT_CLASSIFIER_PROMPTS.en;
  const historyStr =
    conversationHistory.length > 0
      ? conversationHistory
          .map(
            (h) =>
              `${h.role === 'user' ? 'User' : 'Nemoris'}: ${(h.content || '').slice(0, 500)}`
          )
          .join('\n')
      : '(no prior messages)';
  const userContent = `Conversation:\n${historyStr}\n\nLatest message:\n${(text || '').slice(0, 2000)}`;

  // Prefer local qwen2.5:3b for classification (free, fast on M1)
  // Classification is simpler than generation — small model handles it fine
  const LOCAL_CLASSIFY_MODEL = 'qwen2.5:3b';
  const classifyMessages = [
    { role: 'system', content: `${systemPrompt}\nReply with JSON only, no markdown or other text.` },
    { role: 'user', content: userContent },
  ];

  try {
    let raw;
    if (LLM_PROVIDER === 'openai') {
      const response = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.1,
        max_tokens: 80,
        response_format: { type: 'json_object' },
      });
      raw = response.choices[0].message.content;
    } else {
      // Try local Ollama first (free), fall back to cloud
      try {
        const localOllama = new OpenAI({ apiKey: 'not-needed', baseURL: `${LLM_URL}/v1` });
        const localResponse = await localOllama.chat.completions.create({
          model: LOCAL_CLASSIFY_MODEL,
          messages: classifyMessages,
          temperature: 0.1,
          max_tokens: 80,
        });
        raw = localResponse.choices[0].message.content;
      } catch {
        logger.info('Local LLM classification failed, trying cloud...');
        raw = await chatCompletionLocal(classifyMessages, DEFAULT_MODEL, 80);
      }
    }

    const result = parseJsonIntentResponse(raw);
    if (result) {
      return { ...result, source: 'llm' };
    }
    logger.warn('classifyIntentWithLLM: invalid intent in response:', raw);
    return null;
  } catch (error) {
    logger.error('classifyIntentWithLLM failed:', error);
    return null;
  }
}

export async function extractEntitiesWithLLM(text, userContext = '', language = 'en') {
  const prompts = SYSTEM_PROMPTS[language] || SYSTEM_PROMPTS.en;
  
  const systemPrompt = prompts.extraction;
  const userContextStr = userContext ? `\nUser context: ${userContext}` : '';
  const model = LLM_PROVIDER === 'openai' ? 'gpt-4o-mini' : DEFAULT_MODEL;

  try {
    if (LLM_PROVIDER !== 'openai') {
      const response = await chatCompletionLocal(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text.slice(0, 1000) + userContextStr },
        ],
        model,
        300
      );
      
      const cleaned = response
        .replace(/^\s*```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim();
      const parsed = JSON.parse(cleaned);
      return {
        type: parsed.type || 'fact',
        entities: parsed.entities || {},
        isMemory: parsed.isMemory || false,
        summary: parsed.summary || null,
      };
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text.slice(0, 1000) + userContextStr },
      ],
      temperature: 0.3,
      max_tokens: 300,
      response_format: { type: 'json_object' },
    });
    
    const result = JSON.parse(response.choices[0].message.content);
    return {
      ...result,
      type: result.type || 'fact',
      entities: result.entities || {},
      isMemory: result.isMemory || false,
      summary: result.summary || null,
    };
  } catch (error) {
    console.error('Error extracting entities:', error);
    return { isMemory: false, type: null, entities: {}, summary: null };
  }
}

export async function generateResponse(userQuestion, retrievedMemories = [], conversationHistory = [], language = 'en', userName = null) {
  const cacheKey = getCacheKey(userQuestion, retrievedMemories);
  const cached = getCachedResponse(cacheKey);
  if (cached) {
    return cached;
  }

  const prompts = SYSTEM_PROMPTS[language] || SYSTEM_PROMPTS.en;
  
  const context = retrievedMemories.length > 0 
    ? `Memories:\n${retrievedMemories.slice(0, 3).map(m => `• ${m}`).join('\n')}`
    : '';

  const history = conversationHistory.length > 0
    ? `Chat:\n${conversationHistory.map(h => `${h.role === 'user' ? 'User' : 'Nemoris'}: ${h.content.slice(0, 200)}`).join('\n')}`
    : '';

  const nameLine = userName ? `User name: ${userName}` : '';

  const systemPrompt = `${prompts.response}

${context}
${history}
${nameLine}`;

  try {
    let result;
    
    if (LLM_PROVIDER !== 'openai') {
      result = await chatCompletionLocal(
        [
          { role: 'system', content: systemPrompt.slice(0, 2000) },
          { role: 'user', content: userQuestion.slice(0, 2000) },
        ],
        DEFAULT_MODEL,
        200
      );
    } else {
      const response = await openai.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          { role: 'system', content: systemPrompt.slice(0, 2000) },
          { role: 'user', content: userQuestion.slice(0, 2000) },
        ],
        temperature: 0.7,
        max_tokens: 200,
      });
      result = response.choices[0].message.content;
    }
    
    setCachedResponse(cacheKey, result);
    return result;
  } catch (error) {
    console.error('Error generating response:', error);
    throw error;
  }
}

export function clearCache() {
  responseCache.clear();
}

export function getLLMConfig() {
  return {
    provider: LLM_PROVIDER,
    url: LLM_URL,
    model: DEFAULT_MODEL,
    isLocal: IS_LOCAL,
  };
}
