import cron from 'node-cron';
import { prisma } from '../config/database.js';
import { sendWhatsAppMessage } from '../config/waha.js';
import { logger } from '../utils/logger.js';

let scheduler = null;

export function initScheduler() {
  const cronExpression = process.env.REMINDER_CHECK_INTERVAL || '* * * * *';

  scheduler = cron.schedule(cronExpression, async () => {
    await checkAndSendReminders();
  });

  logger.info(`Reminder scheduler started: ${cronExpression}`);
}

export async function checkAndSendReminders() {
  try {
    const now = new Date();
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

    const pendingReminders = await prisma.reminder.findMany({
      where: {
        sent: false,
        scheduledAt: { gte: now, lte: fiveMinutesFromNow },
      },
      include: { user: { select: { chatId: true, name: true } } },
    });

    for (const reminder of pendingReminders) {
      try {
        const greeting = reminder.user.name ? `Hai ${reminder.user.name}! ` : '';
        const message = `${greeting}⏰ Waktunya *${reminder.task}*!\n\nKamu sudah minta diingatkan untuk ini. Semangat! 💪`;
        await sendWhatsAppMessage(reminder.user.chatId, message);

        await prisma.reminder.update({
          where: { id: reminder.id },
          data: { sent: true, sentAt: new Date() },
        });

        if (reminder.recurrence) {
          await createNextRecurrence(reminder);
        }

        logger.info(`Reminder sent to ${reminder.user.chatId}: ${reminder.task}`);
      } catch (error) {
        logger.error(`Failed to send reminder ${reminder.id}:`, error);
      }
    }
  } catch (error) {
    logger.error('Error checking reminders:', error);
  }
}

async function createNextRecurrence(reminder) {
  const currentScheduled = reminder.scheduledAt;
  let nextScheduled;

  switch (reminder.recurrence) {
    case 'daily':
      nextScheduled = new Date(currentScheduled.getTime() + 24 * 60 * 60 * 1000);
      break;
    case 'weekly':
      nextScheduled = new Date(currentScheduled.getTime() + 7 * 24 * 60 * 60 * 1000);
      break;
    case 'monthly':
      nextScheduled = new Date(currentScheduled);
      nextScheduled.setMonth(nextScheduled.getMonth() + 1);
      break;
    default:
      return;
  }

  await prisma.reminder.create({
    data: {
      userId: reminder.userId,
      task: reminder.task,
      scheduledAt: nextScheduled,
      recurrence: reminder.recurrence,
    },
  });
}

export async function createReminder(userId, task, scheduledAt, recurrence = null) {
  const reminder = await prisma.reminder.create({
    data: { userId, task, scheduledAt, recurrence },
  });

  logger.info(`Reminder created for user ${userId}: ${task} at ${scheduledAt}`);
  return { id: reminder.id, userId, task, scheduledAt, recurrence };
}

export async function getUserReminders(userId, includeSent = false) {
  const where = { userId };
  if (!includeSent) {
    where.sent = false;
  }

  return prisma.reminder.findMany({
    where,
    orderBy: { scheduledAt: 'asc' },
  });
}

export async function cancelReminder(reminderId, userId) {
  const result = await prisma.reminder.deleteMany({
    where: { id: reminderId, userId },
  });
  return result;
}

export function stopScheduler() {
  if (scheduler) {
    scheduler.stop();
    logger.info('Reminder scheduler stopped');
  }
}
