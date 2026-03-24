import OpenAI from 'openai';
import axios from 'axios';

const LLM_PROVIDER = process.env.LLM_PROVIDER || 'openai';
const LLM_URL = process.env.LLM_URL || 'http://localhost:11434';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'not-needed';
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
    embeddingModel = 'text-embedding-3-small';
  } else {
    openai = new OpenAI({
      apiKey: OPENAI_API_KEY,
    });
  }
}

initOpenAI();

export const DEFAULT_MODEL = OPENAI_MODEL;
export const IS_LOCAL = LLM_PROVIDER !== 'openai' && LLM_PROVIDER !== 'google';

const SYSTEM_PROMPTS = {
  en: {
    extraction: `Extract info from user message. Types: fact, preference, event.
Response JSON: {"type":"fact|preference|event","entities":{},"isMemory":true|false,"summary":"brief summary"}`,
    response: `You are Nemoris, a friendly personal AI assistant. 
Rules: Be conversational, concise, honest if unsure, use user's name.
Format: Plain text, no markdown.`,
  },
  id: {
    extraction: `Ekstrak informasi dari pesan pengguna. Tipe: fact, preference, event.
Response JSON: {"type":"fact|preference|event","entities":{},"isMemory":true|false,"summary":"ringkasan singkat"}`,
    response: `Anda adalah Nemoris, asisten AI personal yang ramah.
Aturan: Percakapan alami, singkat, jujur jika tidak tahu, gunakan nama pengguna.
Format: Teks biasa, tanpa markdown.`,
  },
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
  if (LLM_PROVIDER === 'local' || LLM_PROVIDER === 'ollama') {
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
      return data.embedding;
    } catch (error) {
      console.error('Error generating embedding (local):', error);
      return Array(768).fill(0);
    }
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
      console.error('Error generating embedding (OpenAI):', error);
    }
  }

  console.warn('No embedding provider available, using zeros');
  return Array(1536).fill(0);
}

async function chatCompletionLocal(messages, model, maxTokens = 500) {
  try {
    const isOpenCodeProxy = LLM_PROVIDER === 'opencode';
    
    if (isOpenCodeProxy) {
      const response = await axios.post(`${LLM_URL}/v1/chat/completions`, {
        model: model,
        messages: messages,
        temperature: 0.7,
        max_tokens: maxTokens,
      }, {
        timeout: 120000,
      });
      return response.data.choices[0].message.content;
    }
    
    const response = await fetch(`${LLM_URL}/api/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        messages: messages,
        temperature: 0.7,
        max_tokens: maxTokens,
        stream: false,
      }),
    });
    const data = await response.json();
    return data.message?.content || data.choices?.[0]?.message?.content || '';
  } catch (error) {
    console.error('Error in local chat completion:', error);
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
      
      const parsed = JSON.parse(response);
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
    ? `Chat:\n${conversationHistory.slice(-3).map(h => `${h.role === 'user' ? 'User' : 'Nemoris'}: ${h.content.slice(0, 100)}`).join('\n')}`
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
        300
      );
    } else {
      const response = await openai.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          { role: 'system', content: systemPrompt.slice(0, 2000) },
          { role: 'user', content: userQuestion.slice(0, 2000) },
        ],
        temperature: 0.7,
        max_tokens: 300,
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
