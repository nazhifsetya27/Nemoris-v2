import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────────

const mockFindUnique = vi.fn();
const mockUserCreate = vi.fn().mockImplementation(({ data }) =>
  Promise.resolve({ id: 'user-1', ...data })
);

vi.mock('../../config/database.js', () => ({
  prisma: {
    user: {
      findUnique: (...args) => mockFindUnique(...args),
      create: (...args) => mockUserCreate(...args),
    },
  },
}));

const mockSendMessage = vi.fn().mockResolvedValue(true);
const mockGetContact = vi.fn().mockResolvedValue({ name: 'Test User', pushName: 'Test' });
const mockGetPhoneFromLid = vi.fn().mockResolvedValue(null);

vi.mock('../../config/waha.js', () => ({
  sendWhatsAppMessage: (...args) => mockSendMessage(...args),
  getContact: (...args) => mockGetContact(...args),
  getPhoneNumberFromLid: (...args) => mockGetPhoneFromLid(...args),
}));

const mockStoreMemory = vi.fn().mockResolvedValue({ id: 'mem-1' });
const mockRetrieveMemories = vi.fn().mockResolvedValue(['memory 1']);
const mockGetHistory = vi.fn().mockResolvedValue([]);
const mockStoreMessage = vi.fn().mockResolvedValue({ id: 'msg-1' });

vi.mock('../../services/memory.js', () => ({
  storeMemory: (...args) => mockStoreMemory(...args),
  retrieveRelevantMemories: (...args) => mockRetrieveMemories(...args),
  getConversationHistory: (...args) => mockGetHistory(...args),
  storeMessage: (...args) => mockStoreMessage(...args),
}));

const mockGenerateResponse = vi.fn().mockResolvedValue('AI response here');
const mockExtractEntities = vi.fn().mockResolvedValue({
  isMemory: true, type: 'fact', entities: {}, summary: 'test summary',
});
const mockClassifyIntent = vi.fn().mockResolvedValue({ intent: 'question', source: 'llm' });

vi.mock('../../services/openai.js', () => ({
  generateResponse: (...args) => mockGenerateResponse(...args),
  extractEntitiesWithLLM: (...args) => mockExtractEntities(...args),
  classifyIntentWithLLM: (...args) => mockClassifyIntent(...args),
}));

vi.mock('../../services/reminder.js', () => ({
  createReminder: vi.fn().mockResolvedValue({ id: 'rem-1' }),
}));

vi.mock('../../services/context.js', () => ({
  getContext: vi.fn().mockReturnValue(null),
  setContext: vi.fn(),
  inferContextFromResponse: vi.fn().mockReturnValue({ lastBotAction: 'general_response' }),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { handleIncomingMessage } = await import('../message.js');

beforeEach(() => {
  vi.clearAllMocks();
  // Default: existing user
  mockFindUnique.mockResolvedValue({ id: 'user-1', chatId: '628123@c.us', name: 'Budi' });
});

// ─── Input Validation ───────────────────────────────────────────────────────────

describe('input validation', () => {
  describe('negative: rejects invalid payloads', () => {
    it('returns early when "from" is missing', async () => {
      await handleIncomingMessage({ text: 'hello' });
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('returns early when "text" is missing', async () => {
      await handleIncomingMessage({ from: '628123@c.us' });
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('returns early for empty payload', async () => {
      await handleIncomingMessage({});
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });
});

// ─── Ping/Test Filter (BUG 5 fix validation) ────────────────────────────────────

describe('ping/test filter', () => {
  describe('positive: filters test messages before processing', () => {
    it.each([
      'ping', 'PING', 'Ping', 'pInG',
      'test', 'TEST', 'Test', 'TeSt',
      '  ping  ', '  test  ',
    ])('filters out "%s" without processing', async (text) => {
      await handleIncomingMessage({ from: '628123@c.us', text });

      // Should NOT store any messages, call LLM, or send response
      expect(mockStoreMessage).not.toHaveBeenCalled();
      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(mockGenerateResponse).not.toHaveBeenCalled();
    });
  });

  describe('negative: does not filter normal messages', () => {
    it.each([
      'testing', 'pinging', 'test me', 'ping pong',
      'this is a test message', 'hello',
    ])('processes "%s" normally', async (text) => {
      await handleIncomingMessage({ from: '628123@c.us', text });
      expect(mockStoreMessage).toHaveBeenCalled();
    });
  });
});

// ─── New User Registration ──────────────────────────────────────────────────────

describe('new user registration', () => {
  beforeEach(() => {
    mockFindUnique.mockResolvedValue(null); // user not found
  });

  describe('positive: auto-registers new users', () => {
    it('creates user and sends welcome message', async () => {
      await handleIncomingMessage({ from: '628999@c.us', text: 'hello' });

      expect(mockUserCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          chatId: '628999@c.us',
          name: 'Test User',
        }),
      });
      expect(mockSendMessage).toHaveBeenCalledWith(
        '628999@c.us',
        expect.stringContaining("I'm Nemoris")
      );
      expect(mockStoreMessage).toHaveBeenCalledWith(
        'user-1', 'assistant', expect.stringContaining("I'm Nemoris")
      );
    });
  });

  describe('positive: resolves LID for new users', () => {
    it('resolves @lid chatId to phone number', async () => {
      mockGetPhoneFromLid.mockResolvedValueOnce('628555@c.us');
      await handleIncomingMessage({ from: '204917@lid', text: 'hello' });

      expect(mockUserCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ phone: '628555' }),
      });
    });
  });

  describe('negative: new user returns early (no intent processing)', () => {
    it('does not process intent for new users', async () => {
      await handleIncomingMessage({ from: '628999@c.us', text: 'remind me to buy milk' });

      // Should only send welcome, not process the reminder
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage).toHaveBeenCalledWith(
        '628999@c.us',
        expect.stringContaining("I'm Nemoris")
      );
    });
  });
});

// ─── Intent Routing ─────────────────────────────────────────────────────────────

describe('intent routing', () => {
  describe('positive: reminder intent', () => {
    it('handles reminder with task and time', async () => {
      await handleIncomingMessage({ from: '628123@c.us', text: 'remind me to study at 3pm' });

      expect(mockStoreMessage).toHaveBeenCalledWith('user-1', 'user', 'remind me to study at 3pm');
      // Should store assistant response too
      expect(mockStoreMessage).toHaveBeenCalledTimes(2);
      expect(mockSendMessage).toHaveBeenCalledOnce();
    });
  });

  describe('positive: memory intent', () => {
    it('handles memory storage with LLM extraction', async () => {
      await handleIncomingMessage({ from: '628123@c.us', text: 'my name is John' });

      expect(mockStoreMessage).toHaveBeenCalledWith('user-1', 'user', 'my name is John');
      expect(mockSendMessage).toHaveBeenCalledOnce();
    });
  });

  describe('positive: question intent', () => {
    it('handles questions with RAG pipeline', async () => {
      await handleIncomingMessage({ from: '628123@c.us', text: 'what is my name?' });

      expect(mockRetrieveMemories).toHaveBeenCalled();
      expect(mockGenerateResponse).toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledWith('628123@c.us', 'AI response here');
    });
  });

  describe('positive: question passes userId to generateResponse (BUG 3 fix validation)', () => {
    it('first arg to generateResponse is userId', async () => {
      await handleIncomingMessage({ from: '628123@c.us', text: 'what is my name?' });

      expect(mockGenerateResponse).toHaveBeenCalledWith(
        'user-1',           // userId (first arg — the fix)
        'what is my name?', // question
        expect.any(Array),  // memories
        expect.any(Array),  // history
        expect.any(String), // language
        null,               // userName
      );
    });
  });
});

// ─── No Artificial Delay (BUG 4 fix validation) ─────────────────────────────────

describe('no artificial delay', () => {
  it('processes messages without pre-delay', async () => {
    const start = Date.now();
    await handleIncomingMessage({ from: '628123@c.us', text: 'hello' });
    const elapsed = Date.now() - start;

    // Should complete in well under 1 second (no 1-4s delay)
    // The mocks resolve instantly, so this should be ~0ms
    expect(elapsed).toBeLessThan(500);
  });
});

// ─── Message Storage ────────────────────────────────────────────────────────────

describe('message storage', () => {
  describe('positive: stores both user and assistant messages', () => {
    it('stores user message then assistant response', async () => {
      await handleIncomingMessage({ from: '628123@c.us', text: 'what is 2+2?' });

      const calls = mockStoreMessage.mock.calls;
      expect(calls.length).toBe(2);
      expect(calls[0]).toEqual(['user-1', 'user', 'what is 2+2?']);
      expect(calls[1][0]).toBe('user-1');
      expect(calls[1][1]).toBe('assistant');
    });
  });
});

// ─── Response Always Sent (no shouldRespond filter) ─────────────────────────────

describe('response sending', () => {
  describe('positive: response is always sent for non-test messages', () => {
    it('sends response unconditionally', async () => {
      await handleIncomingMessage({ from: '628123@c.us', text: 'hello' });
      expect(mockSendMessage).toHaveBeenCalledOnce();
    });
  });
});
