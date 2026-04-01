import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────────

const mockFindMany = vi.fn().mockResolvedValue([]);
const mockUpdate = vi.fn().mockResolvedValue({});
const mockCreate = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'rem-1', ...data }));
const mockDeleteMany = vi.fn().mockResolvedValue({ count: 1 });

vi.mock('../../config/database.js', () => ({
  prisma: {
    reminder: {
      findMany: (...args) => mockFindMany(...args),
      update: (...args) => mockUpdate(...args),
      create: (...args) => mockCreate(...args),
      deleteMany: (...args) => mockDeleteMany(...args),
    },
  },
}));

const mockSendMessage = vi.fn().mockResolvedValue(true);
vi.mock('../../config/waha.js', () => ({
  sendWhatsAppMessage: (...args) => mockSendMessage(...args),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Must use dynamic import after mocks are set up
const { checkAndSendReminders, createReminder, getUserReminders, cancelReminder } = await import('../reminder.js');

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── checkAndSendReminders ──────────────────────────────────────────────────────

describe('checkAndSendReminders', () => {
  describe('positive: sends pending reminders within window', () => {
    it('sends a reminder that is within the 5-minute window', async () => {
      const twoMinFromNow = new Date(Date.now() + 2 * 60 * 1000);
      mockFindMany.mockResolvedValueOnce([
        {
          id: 'rem-1',
          task: 'buy milk',
          scheduledAt: twoMinFromNow,
          recurrence: null,
          userId: 'user-1',
          user: { chatId: '628123@c.us', name: 'Budi' },
        },
      ]);

      await checkAndSendReminders();

      expect(mockSendMessage).toHaveBeenCalledOnce();
      expect(mockSendMessage).toHaveBeenCalledWith(
        '628123@c.us',
        expect.stringContaining('buy milk')
      );
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'rem-1' },
        data: { sent: true, sentAt: expect.any(Date) },
      });
    });
  });

  describe('positive: catches past-due reminders (BUG 2 fix validation)', () => {
    it('query uses lte:fiveMinutesFromNow without gte:now', async () => {
      mockFindMany.mockResolvedValueOnce([]);
      await checkAndSendReminders();

      const whereClause = mockFindMany.mock.calls[0][0].where;
      expect(whereClause.sent).toBe(false);
      expect(whereClause.scheduledAt).toHaveProperty('lte');
      // CRITICAL: must NOT have gte (that was the bug)
      expect(whereClause.scheduledAt).not.toHaveProperty('gte');
    });
  });

  describe('positive: sends past-due reminders from downtime', () => {
    it('sends a reminder that was scheduled 10 minutes ago', async () => {
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
      mockFindMany.mockResolvedValueOnce([
        {
          id: 'rem-old',
          task: 'past reminder',
          scheduledAt: tenMinAgo,
          recurrence: null,
          userId: 'user-1',
          user: { chatId: '628123@c.us', name: null },
        },
      ]);

      await checkAndSendReminders();

      expect(mockSendMessage).toHaveBeenCalledWith(
        '628123@c.us',
        expect.stringContaining('past reminder')
      );
    });
  });

  describe('positive: greeting with user name', () => {
    it('includes user name in greeting when available', async () => {
      mockFindMany.mockResolvedValueOnce([
        {
          id: 'rem-1', task: 'test', scheduledAt: new Date(), recurrence: null,
          userId: 'u1', user: { chatId: '123@c.us', name: 'Budi' },
        },
      ]);

      await checkAndSendReminders();

      expect(mockSendMessage).toHaveBeenCalledWith(
        '123@c.us',
        expect.stringContaining('Hai Budi!')
      );
    });

    it('omits greeting when user has no name', async () => {
      mockFindMany.mockResolvedValueOnce([
        {
          id: 'rem-1', task: 'test', scheduledAt: new Date(), recurrence: null,
          userId: 'u1', user: { chatId: '123@c.us', name: null },
        },
      ]);

      await checkAndSendReminders();

      const message = mockSendMessage.mock.calls[0][1];
      expect(message).not.toContain('Hai');
      expect(message).toContain('test');
    });
  });

  describe('positive: creates next recurrence after sending', () => {
    it('creates daily recurrence', async () => {
      const scheduled = new Date('2025-06-15T10:00:00Z');
      mockFindMany.mockResolvedValueOnce([
        {
          id: 'rem-1', task: 'exercise', scheduledAt: scheduled, recurrence: 'daily',
          userId: 'u1', user: { chatId: '123@c.us', name: null },
        },
      ]);

      await checkAndSendReminders();

      // First call = mark sent, second call = create recurrence
      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          task: 'exercise',
          recurrence: 'daily',
          scheduledAt: new Date('2025-06-16T10:00:00Z'),
        }),
      });
    });

    it('creates weekly recurrence', async () => {
      const scheduled = new Date('2025-06-15T10:00:00Z');
      mockFindMany.mockResolvedValueOnce([
        {
          id: 'rem-1', task: 'call mom', scheduledAt: scheduled, recurrence: 'weekly',
          userId: 'u1', user: { chatId: '123@c.us', name: null },
        },
      ]);

      await checkAndSendReminders();

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          scheduledAt: new Date('2025-06-22T10:00:00Z'),
          recurrence: 'weekly',
        }),
      });
    });

    it('creates monthly recurrence', async () => {
      const scheduled = new Date('2025-06-15T10:00:00Z');
      mockFindMany.mockResolvedValueOnce([
        {
          id: 'rem-1', task: 'pay rent', scheduledAt: scheduled, recurrence: 'monthly',
          userId: 'u1', user: { chatId: '123@c.us', name: null },
        },
      ]);

      await checkAndSendReminders();

      const createdData = mockCreate.mock.calls[0][0].data;
      expect(createdData.scheduledAt.getMonth()).toBe(6); // July (0-indexed)
    });

    it('clamps monthly recurrence on edge date: Jan 31 → Feb 28 (HIGH-3 fix)', async () => {
      const jan31 = new Date('2025-01-31T10:00:00Z');
      mockFindMany.mockResolvedValueOnce([
        {
          id: 'rem-edge', task: 'edge case', scheduledAt: jan31, recurrence: 'monthly',
          userId: 'u1', user: { chatId: '123@c.us', name: null },
        },
      ]);

      await checkAndSendReminders();

      const createdData = mockCreate.mock.calls[0][0].data;
      // Should be Feb 28 (2025 is not a leap year), NOT Mar 3
      expect(createdData.scheduledAt.getMonth()).toBe(1); // February
      expect(createdData.scheduledAt.getDate()).toBe(28);
    });

    it('clamps monthly recurrence: Mar 31 → Apr 30', async () => {
      const mar31 = new Date('2025-03-31T10:00:00Z');
      mockFindMany.mockResolvedValueOnce([
        {
          id: 'rem-edge2', task: 'pay bills', scheduledAt: mar31, recurrence: 'monthly',
          userId: 'u1', user: { chatId: '123@c.us', name: null },
        },
      ]);

      await checkAndSendReminders();

      const createdData = mockCreate.mock.calls[0][0].data;
      expect(createdData.scheduledAt.getMonth()).toBe(3); // April
      expect(createdData.scheduledAt.getDate()).toBe(30);
    });
  });

  describe('negative: no pending reminders', () => {
    it('does nothing when no reminders are pending', async () => {
      mockFindMany.mockResolvedValueOnce([]);
      await checkAndSendReminders();
      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe('negative: handles send failure gracefully', () => {
    it('continues processing other reminders when one fails', async () => {
      mockFindMany.mockResolvedValueOnce([
        {
          id: 'rem-fail', task: 'fail task', scheduledAt: new Date(), recurrence: null,
          userId: 'u1', user: { chatId: 'bad@c.us', name: null },
        },
        {
          id: 'rem-ok', task: 'ok task', scheduledAt: new Date(), recurrence: null,
          userId: 'u2', user: { chatId: 'good@c.us', name: null },
        },
      ]);

      mockSendMessage.mockRejectedValueOnce(new Error('Send failed'));
      mockSendMessage.mockResolvedValueOnce(true);

      await checkAndSendReminders();

      // Second reminder should still be sent despite first failing
      expect(mockSendMessage).toHaveBeenCalledTimes(2);
    });
  });

  describe('negative: does not create recurrence for null recurrence', () => {
    it('skips recurrence creation for one-time reminders', async () => {
      mockFindMany.mockResolvedValueOnce([
        {
          id: 'rem-once', task: 'one time', scheduledAt: new Date(), recurrence: null,
          userId: 'u1', user: { chatId: '123@c.us', name: null },
        },
      ]);

      await checkAndSendReminders();

      // create is not called (no recurrence to schedule)
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });
});

// ─── createReminder ─────────────────────────────────────────────────────────────

describe('createReminder', () => {
  describe('positive: creates reminder in database', () => {
    it('creates with all fields', async () => {
      const scheduledAt = new Date('2025-12-25T10:00:00Z');
      const result = await createReminder('user-1', 'open presents', scheduledAt, 'daily');

      expect(mockCreate).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          task: 'open presents',
          scheduledAt,
          recurrence: 'daily',
        },
      });
      expect(result).toHaveProperty('id');
      expect(result.task).toBe('open presents');
    });
  });

  describe('positive: creates without recurrence', () => {
    it('recurrence defaults to null', async () => {
      await createReminder('user-1', 'one-time task', new Date());

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ recurrence: null }),
      });
    });
  });
});

// ─── getUserReminders ───────────────────────────────────────────────────────────

describe('getUserReminders', () => {
  describe('positive: filters unsent by default', () => {
    it('only fetches unsent reminders', async () => {
      mockFindMany.mockResolvedValueOnce([]);
      await getUserReminders('user-1');

      expect(mockFindMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', sent: false },
        orderBy: { scheduledAt: 'asc' },
      });
    });
  });

  describe('positive: includes sent when requested', () => {
    it('fetches all reminders including sent', async () => {
      mockFindMany.mockResolvedValueOnce([]);
      await getUserReminders('user-1', true);

      expect(mockFindMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { scheduledAt: 'asc' },
      });
    });
  });
});

// ─── cancelReminder ─────────────────────────────────────────────────────────────

describe('cancelReminder', () => {
  describe('positive: deletes by id and userId', () => {
    it('calls deleteMany with correct where clause', async () => {
      await cancelReminder('rem-1', 'user-1');
      expect(mockDeleteMany).toHaveBeenCalledWith({
        where: { id: 'rem-1', userId: 'user-1' },
      });
    });
  });

  describe('negative: cannot delete another user\'s reminder', () => {
    it('deleteMany scoped to userId prevents cross-user deletion', async () => {
      mockDeleteMany.mockResolvedValueOnce({ count: 0 });
      const result = await cancelReminder('rem-1', 'wrong-user');
      expect(result.count).toBe(0);
    });
  });
});
