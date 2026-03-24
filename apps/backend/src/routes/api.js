import express from 'express';
import { sendWhatsAppMessage, getQueueStatus } from '../config/waha.js';
import { prisma } from '../config/database.js';
import { getUserReminders, cancelReminder } from '../services/reminder.js';
import { getUserMemories, deleteMemory } from '../services/memory.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

router.post('/send', async (req, res) => {
  try {
    const { chatId, text } = req.body;

    if (!chatId || !text) {
      return res.status(400).json({ error: 'chatId and text are required' });
    }

    const result = await sendWhatsAppMessage(chatId, text);
    res.json({ success: true, result });
  } catch (error) {
    logger.error('Send message error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/users/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;

    const user = await prisma.user.findUnique({
      where: { chatId },
      include: {
        _count: { select: { memories: true, reminders: true, messages: true } },
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { _count, ...userData } = user;
    res.json({ ...userData, _count });
  } catch (error) {
    logger.error('Get user error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/users/:chatId/reminders', async (req, res) => {
  try {
    const { chatId } = req.params;
    const { includeSent } = req.query;

    const user = await prisma.user.findUnique({ where: { chatId } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const reminders = await getUserReminders(user.id, includeSent === 'true');
    res.json(reminders);
  } catch (error) {
    logger.error('Get reminders error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/users/:chatId/reminders/:reminderId', async (req, res) => {
  try {
    const { chatId, reminderId } = req.params;

    const user = await prisma.user.findUnique({ where: { chatId } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await cancelReminder(reminderId, user.id);
    res.json({ success: true });
  } catch (error) {
    logger.error('Cancel reminder error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/users/:chatId/memories', async (req, res) => {
  try {
    const { chatId } = req.params;
    const { type, limit } = req.query;

    const user = await prisma.user.findUnique({ where: { chatId } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const memories = await getUserMemories(user.id, type || undefined, parseInt(limit) || 50);
    res.json(memories);
  } catch (error) {
    logger.error('Get memories error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/users/:chatId/memories/:memoryId', async (req, res) => {
  try {
    const { chatId, memoryId } = req.params;

    const user = await prisma.user.findUnique({ where: { chatId } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await deleteMemory(user.id, memoryId);
    res.json({ success: true });
  } catch (error) {
    logger.error('Delete memory error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/queue/status', (req, res) => {
  const status = getQueueStatus();
  res.json(status);
});

export default router;
