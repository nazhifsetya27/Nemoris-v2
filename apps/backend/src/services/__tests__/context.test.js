import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getContext, setContext, inferContextFromResponse } from '../context.js';

beforeEach(() => {
  // Clear any leftover context from previous tests
  // setContext with a known user, then test fresh
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── setContext + getContext ─────────────────────────────────────────────────────

describe('setContext / getContext', () => {
  describe('positive: basic store and retrieve', () => {
    it('stores and retrieves context for a user', () => {
      setContext('user-1', { lastBotAction: 'general_response', pendingSlot: null, lastIntent: 'question' });
      const ctx = getContext('user-1');
      expect(ctx).not.toBeNull();
      expect(ctx.lastBotAction).toBe('general_response');
      expect(ctx.pendingSlot).toBeNull();
      expect(ctx.lastIntent).toBe('question');
    });

    it('overwrites previous context', () => {
      setContext('user-2', { lastBotAction: 'stored_memory', pendingSlot: null });
      setContext('user-2', { lastBotAction: 'reminder_error', pendingSlot: 'reminder_time' });
      const ctx = getContext('user-2');
      expect(ctx.lastBotAction).toBe('reminder_error');
      expect(ctx.pendingSlot).toBe('reminder_time');
    });

    it('isolates context between users', () => {
      setContext('user-a', { lastBotAction: 'stored_memory' });
      setContext('user-b', { lastBotAction: 'reminder_error' });
      expect(getContext('user-a').lastBotAction).toBe('stored_memory');
      expect(getContext('user-b').lastBotAction).toBe('reminder_error');
    });
  });

  describe('positive: updatedAt is set automatically', () => {
    it('context has updatedAt timestamp', () => {
      const now = Date.now();
      setContext('user-ts', { lastBotAction: 'general_response' });
      const ctx = getContext('user-ts');
      expect(ctx.updatedAt).toBeGreaterThanOrEqual(now);
    });
  });

  describe('negative: TTL expiry', () => {
    it('returns null after 5 minutes', () => {
      setContext('user-expire', { lastBotAction: 'stored_memory' });
      expect(getContext('user-expire')).not.toBeNull();

      // Advance 5 minutes + 1ms
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      expect(getContext('user-expire')).toBeNull();
    });

    it('returns context just before 5 minutes', () => {
      setContext('user-edge', { lastBotAction: 'stored_memory' });

      // Advance 4m59s
      vi.advanceTimersByTime(4 * 60 * 1000 + 59 * 1000);

      expect(getContext('user-edge')).not.toBeNull();
    });
  });

  describe('negative: unknown user', () => {
    it('returns null for user with no context', () => {
      expect(getContext('nonexistent-user')).toBeNull();
    });
  });
});

// ─── inferContextFromResponse ───────────────────────────────────────────────────

describe('inferContextFromResponse', () => {
  const enTemplates = {
    reminderError: "Hmm, I need a bit more detail",
    clarification: "Could you clarify?",
    memoryStoredDefault: "I've stored that in my memory!",
  };

  const idTemplates = {
    reminderError: "Hmm, aku butuh info lebih detail",
    clarification: "Bisa diperjelas?",
    memoryStoredDefault: "Sudah saya simpan!",
  };

  describe('positive: reminder error → pending reminder_time', () => {
    it('sets reminder_error context when response matches reminderError template', () => {
      const ctx = inferContextFromResponse(enTemplates.reminderError, 'reminder', enTemplates);
      expect(ctx.lastBotAction).toBe('reminder_error');
      expect(ctx.pendingSlot).toBe('reminder_time');
      expect(ctx.lastIntent).toBe('reminder');
    });

    it('sets reminder_error context for clarification template', () => {
      const ctx = inferContextFromResponse(enTemplates.clarification, 'reminder', enTemplates);
      expect(ctx.lastBotAction).toBe('reminder_error');
      expect(ctx.pendingSlot).toBe('reminder_time');
    });

    it('works with Indonesian templates too', () => {
      const ctx = inferContextFromResponse(idTemplates.reminderError, 'reminder', idTemplates);
      expect(ctx.lastBotAction).toBe('reminder_error');
    });
  });

  describe('positive: memory stored', () => {
    it('sets stored_memory when response matches memoryStoredDefault', () => {
      const ctx = inferContextFromResponse(enTemplates.memoryStoredDefault, 'memory', enTemplates);
      expect(ctx.lastBotAction).toBe('stored_memory');
      expect(ctx.pendingSlot).toBeNull();
      expect(ctx.lastIntent).toBe('memory');
    });

    it('sets stored_memory when response starts with checkmark', () => {
      const ctx = inferContextFromResponse('✅ Got it!', 'memory', enTemplates);
      expect(ctx.lastBotAction).toBe('stored_memory');
    });
  });

  describe('positive: asked_info detection', () => {
    it('detects when bot asks for info (EN)', () => {
      const ctx = inferContextFromResponse('Could you tell me more about that?', 'question', enTemplates);
      expect(ctx.lastBotAction).toBe('asked_info');
      expect(ctx.pendingSlot).toBe('person_name');
    });

    it('detects when bot asks for info (ID)', () => {
      const ctx = inferContextFromResponse('Bisa kasih tahu siapa dia?', 'question', idTemplates);
      expect(ctx.lastBotAction).toBe('asked_info');
      expect(ctx.pendingSlot).toBe('person_name');
    });
  });

  describe('positive: general response fallback', () => {
    it('defaults to general_response for regular replies', () => {
      const ctx = inferContextFromResponse('Hello! How can I help?', 'question', enTemplates);
      expect(ctx.lastBotAction).toBe('general_response');
      expect(ctx.pendingSlot).toBeNull();
    });
  });

  describe('negative: preserves intent in all cases', () => {
    it('carries intent through to context', () => {
      const ctx = inferContextFromResponse('Some response', 'memory', enTemplates);
      expect(ctx.lastIntent).toBe('memory');
    });
  });
});
