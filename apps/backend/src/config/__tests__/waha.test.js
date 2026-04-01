import { describe, it, expect, vi, beforeEach } from 'vitest';

// Set delay env vars BEFORE importing waha.js (these are read at module load)
process.env.MIN_MESSAGE_DELAY = '1';
process.env.MAX_MESSAGE_DELAY = '1';

// Mock axios before import
const postMock = vi.fn().mockResolvedValue({ data: { sent: true } });
const getMock = vi.fn().mockResolvedValue({ data: {} });

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      post: postMock,
      get: getMock,
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    })),
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const {
  sendWhatsAppMessage,
  sendWhatsAppMessageWithButtons,
  sendWhatsAppMessageImmediate,
  getQueueStatus,
  checkWAHAConnection,
  getPhoneNumberFromLid,
  getContact,
} = await import('../waha.js');

beforeEach(() => {
  postMock.mockClear();
  getMock.mockClear();
  postMock.mockResolvedValue({ data: { sent: true } });
});

// ─── Message Queue ──────────────────────────────────────────────────────────────

describe('message queue', () => {
  describe('positive: text messages sent via /api/sendText', () => {
    it('sends a text message through the queue', async () => {
      await sendWhatsAppMessage('123@c.us', 'hello');
      expect(postMock).toHaveBeenCalledWith('/api/sendText', expect.objectContaining({
        chatId: '123@c.us',
        text: 'hello',
      }));
    });
  });

  describe('positive: button messages sent via /api/sendButtons (BUG 1 fix validation)', () => {
    it('sends a button message through the queue via /api/sendButtons', async () => {
      const buttons = [{ id: '1', text: 'Yes' }, { id: '2', text: 'No' }];
      await sendWhatsAppMessageWithButtons('123@c.us', 'Choose:', buttons);
      expect(postMock).toHaveBeenCalledWith('/api/sendButtons', expect.objectContaining({
        chatId: '123@c.us',
        text: 'Choose:',
        buttons,
      }));
    });

    it('does NOT call /api/sendText for button messages', async () => {
      const buttons = [{ id: '1', text: 'OK' }];
      await sendWhatsAppMessageWithButtons('123@c.us', 'Pick:', buttons);
      // Should only be called with sendButtons, not sendText
      expect(postMock).not.toHaveBeenCalledWith('/api/sendText', expect.anything());
    });
  });

  describe('positive: queue processes in order', () => {
    it('sends messages in FIFO order', async () => {
      const order = [];
      postMock.mockImplementation(async (_url, data) => {
        order.push(data.text);
        return { data: { sent: true } };
      });

      // Send 3 messages and wait for all to complete
      await Promise.all([
        sendWhatsAppMessage('123@c.us', 'first'),
        sendWhatsAppMessage('123@c.us', 'second'),
        sendWhatsAppMessage('123@c.us', 'third'),
      ]);

      expect(order).toEqual(['first', 'second', 'third']);
    }, 15000);
  });

  describe('positive: immediate send bypasses queue', () => {
    it('sends directly without queuing', async () => {
      await sendWhatsAppMessageImmediate('123@c.us', 'urgent');
      expect(postMock).toHaveBeenCalledWith('/api/sendText', expect.objectContaining({
        text: 'urgent',
      }));
    });
  });

  describe('negative: queue rejects on send failure', () => {
    it('rejects the promise when WAHA API fails', async () => {
      postMock.mockRejectedValueOnce(new Error('WAHA down'));
      await expect(sendWhatsAppMessage('123@c.us', 'fail')).rejects.toThrow('WAHA down');
    }, 15000);
  });

  describe('positive: queue status reporting', () => {
    it('reports queue length and processing state', () => {
      const status = getQueueStatus();
      expect(status).toHaveProperty('queueLength');
      expect(status).toHaveProperty('isProcessing');
      expect(typeof status.queueLength).toBe('number');
      expect(typeof status.isProcessing).toBe('boolean');
    });
  });
});

// ─── WAHA Connection ────────────────────────────────────────────────────────────

describe('checkWAHAConnection', () => {
  describe('positive: recognizes valid statuses', () => {
    it.each(['LOADED', 'WORKING', 'SCAN_QR_CODE'])('returns true for status "%s"', async (status) => {
      getMock.mockResolvedValueOnce({ data: { status } });
      const result = await checkWAHAConnection();
      expect(result).toBe(true);
    });
  });

  describe('negative: rejects invalid statuses', () => {
    it('returns false for STOPPED status', async () => {
      getMock.mockResolvedValueOnce({ data: { status: 'STOPPED' } });
      const result = await checkWAHAConnection();
      expect(result).toBe(false);
    });
  });

  describe('negative: handles connection failure', () => {
    it('returns false when WAHA is unreachable', async () => {
      getMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const result = await checkWAHAConnection();
      expect(result).toBe(false);
    });
  });
});

// ─── LID Resolution ─────────────────────────────────────────────────────────────

describe('getPhoneNumberFromLid', () => {
  describe('positive: resolves LID to phone number', () => {
    it('returns phone JID from WAHA response', async () => {
      getMock.mockResolvedValueOnce({ data: { pn: '628123456@c.us' } });
      const result = await getPhoneNumberFromLid('204917302104303@lid');
      expect(result).toBe('628123456@c.us');
    });
  });

  describe('negative: returns null on failure', () => {
    it('returns null when LID lookup fails', async () => {
      getMock.mockRejectedValueOnce(new Error('Not found'));
      const result = await getPhoneNumberFromLid('invalid@lid');
      expect(result).toBeNull();
    });
  });

  describe('negative: returns null when no pn in response', () => {
    it('returns null when response has no pn field', async () => {
      getMock.mockResolvedValueOnce({ data: {} });
      const result = await getPhoneNumberFromLid('204917302104303@lid');
      expect(result).toBeNull();
    });
  });
});

// ─── getContact ─────────────────────────────────────────────────────────────────

describe('getContact', () => {
  describe('positive: returns contact data', () => {
    it('fetches contact by chatId', async () => {
      getMock.mockResolvedValueOnce({ data: { name: 'John', pushName: 'Johnny' } });
      const result = await getContact('628123@c.us');
      expect(result).toEqual({ name: 'John', pushName: 'Johnny' });
    });
  });

  describe('positive: LID contact resolves via phone lookup', () => {
    it('resolves LID and returns id + null pushName', async () => {
      getMock.mockResolvedValueOnce({ data: { pn: '628123@c.us' } });
      const result = await getContact('204917@lid');
      expect(result).toEqual({ id: '628123@c.us', pushName: null });
    });
  });

  describe('negative: returns null on error', () => {
    it('returns null when API fails', async () => {
      getMock.mockRejectedValueOnce(new Error('Network error'));
      const result = await getContact('628123@c.us');
      expect(result).toBeNull();
    });
  });
});
