import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock external dependencies before importing the module under test
const createMock = vi.fn().mockResolvedValue({
  choices: [{ message: { content: 'mocked response' } }],
});
const embeddingsMock = vi.fn().mockResolvedValue({
  data: [{ embedding: [0.1, 0.2, 0.3] }],
});

vi.mock('openai', () => {
  class MockOpenAI {
    constructor() {
      this.chat = { completions: { create: createMock } };
      this.embeddings = { create: embeddingsMock };
    }
  }
  return { default: MockOpenAI };
});

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Set env vars before importing the module
process.env.LLM_PROVIDER = 'openai';
process.env.OPENAI_API_KEY = 'test-key-12345';
process.env.OPENAI_MODEL = 'gpt-4o-mini';

const { generateResponse, clearCache, classifyIntentWithLLM, extractEntitiesWithLLM } = await import('../openai.js');

beforeEach(() => {
  clearCache();
  createMock.mockClear();
});

// ─── Cache behavior ─────────────────────────────────────────────────────────────

describe('response cache', () => {
  describe('positive: cache hit returns same response', () => {
    it('second call with same args returns cached response without second LLM call', async () => {
      await generateResponse('user-1', 'who is my sister?', ['sister is Lisa'], [], 'en');
      await generateResponse('user-1', 'who is my sister?', ['sister is Lisa'], [], 'en');

      // LLM should only be called once — second call is from cache
      expect(createMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('positive: cache isolates by userId', () => {
    it('different users get separate LLM calls (no cross-user cache)', async () => {
      await generateResponse('user-A', 'who is my sister?', ['sister is Lisa'], [], 'en');
      await generateResponse('user-B', 'who is my sister?', ['sister is Lisa'], [], 'en');

      // Both users trigger separate LLM calls
      expect(createMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('positive: cache isolates by language', () => {
    it('same question in different languages triggers separate LLM calls', async () => {
      await generateResponse('user-1', 'siapa adik saya', ['adik: Lisa'], [], 'id');
      await generateResponse('user-1', 'siapa adik saya', ['adik: Lisa'], [], 'en');

      expect(createMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('negative: cache miss after clearCache', () => {
    it('clearCache forces fresh LLM call', async () => {
      await generateResponse('user-1', 'test question', [], [], 'en');
      expect(createMock).toHaveBeenCalledTimes(1);

      clearCache();
      await generateResponse('user-1', 'test question', [], [], 'en');
      expect(createMock).toHaveBeenCalledTimes(2);
    });
  });
});

// ─── classifyIntentWithLLM ──────────────────────────────────────────────────────

describe('classifyIntentWithLLM', () => {
  describe('positive: parses valid JSON intent response', () => {
    it('returns parsed intent when LLM returns valid JSON', async () => {
      createMock.mockResolvedValueOnce({
        choices: [{ message: { content: '{"intent":"reminder"}' } }],
      });
      const result = await classifyIntentWithLLM('jam 3 sore', [], 'id');
      expect(result).not.toBeNull();
      expect(result.intent).toBe('reminder');
      expect(result.source).toBe('llm');
    });
  });

  describe('positive: handles markdown-wrapped JSON', () => {
    it('strips ```json wrapper before parsing', async () => {
      createMock.mockResolvedValueOnce({
        choices: [{ message: { content: '```json\n{"intent":"memory"}\n```' } }],
      });
      const result = await classifyIntentWithLLM('my name is John', [], 'en');
      expect(result.intent).toBe('memory');
    });
  });

  describe('negative: returns null for invalid JSON', () => {
    it('returns null when LLM returns non-JSON text', async () => {
      createMock.mockResolvedValueOnce({
        choices: [{ message: { content: 'I think this is a question' } }],
      });
      const result = await classifyIntentWithLLM('hello', [], 'en');
      expect(result).toBeNull();
    });
  });

  describe('negative: returns null for invalid intent value', () => {
    it('rejects intent values not in the allowed set', async () => {
      createMock.mockResolvedValueOnce({
        choices: [{ message: { content: '{"intent":"unknown"}' } }],
      });
      const result = await classifyIntentWithLLM('hello', [], 'en');
      expect(result).toBeNull();
    });
  });

  describe('negative: handles empty conversation history', () => {
    it('does not throw with empty history', async () => {
      await expect(classifyIntentWithLLM('test', [], 'en')).resolves.not.toThrow();
    });
  });

  describe('negative: handles null text gracefully', () => {
    it('does not throw with null text', async () => {
      await expect(classifyIntentWithLLM(null, [], 'en')).resolves.not.toThrow();
    });
  });

  describe('negative: handles LLM API failure', () => {
    it('returns null when API throws', async () => {
      createMock.mockRejectedValueOnce(new Error('API rate limit'));
      const result = await classifyIntentWithLLM('hello', [], 'en');
      expect(result).toBeNull();
    });
  });
});

// ─── extractEntitiesWithLLM ─────────────────────────────────────────────────────

describe('extractEntitiesWithLLM', () => {
  describe('positive: extracts entities from valid JSON', () => {
    it('returns parsed entity data', async () => {
      createMock.mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              type: 'fact', entities: { name: 'John' }, isMemory: true, summary: 'User name is John',
            }),
          },
        }],
      });
      const result = await extractEntitiesWithLLM('my name is John', '', 'en');
      expect(result.isMemory).toBe(true);
      expect(result.type).toBe('fact');
      expect(result.summary).toBe('User name is John');
      expect(result.entities).toEqual({ name: 'John' });
    });
  });

  describe('negative: returns safe defaults on LLM failure', () => {
    it('returns isMemory:false on parse error', async () => {
      createMock.mockResolvedValueOnce({
        choices: [{ message: { content: 'not json at all' } }],
      });
      const result = await extractEntitiesWithLLM('my name is John', '', 'en');
      expect(result.isMemory).toBe(false);
      expect(result.entities).toEqual({});
    });
  });

  describe('negative: handles API error', () => {
    it('returns safe defaults on throw', async () => {
      createMock.mockRejectedValueOnce(new Error('timeout'));
      const result = await extractEntitiesWithLLM('test', '', 'en');
      expect(result.isMemory).toBe(false);
      expect(result.type).toBeNull();
    });
  });

  describe('negative: handles empty text', () => {
    it('does not throw with empty string', async () => {
      const result = await extractEntitiesWithLLM('', '', 'en');
      expect(result).toHaveProperty('isMemory');
    });
  });
});
