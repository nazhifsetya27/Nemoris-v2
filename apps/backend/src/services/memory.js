import { prisma } from '../config/database.js';
import { getOrCreateCollection, addMemoryEmbedding, searchMemories, deleteMemoryEmbedding } from '../config/chroma.js';
import { generateEmbedding } from './openai.js';
import { logger } from '../utils/logger.js';

export async function storeMemory(userId, type, content, metadata = {}) {
  const memory = await prisma.memory.create({
    data: {
      userId,
      type,
      content,
      metadata,
      importance: metadata.importance ?? 1,
    },
  });

  try {
    const embedding = await generateEmbedding(content);
    if (embedding) {
      const collection = await getOrCreateCollection(userId);
      await addMemoryEmbedding(collection, memory.id, content, embedding);
      await prisma.memory.update({
        where: { id: memory.id },
        data: { chromaId: memory.id },
      });
    }
    logger.info(`Memory stored for user ${userId}: ${content.substring(0, 50)}...`);
  } catch (error) {
    logger.error('Error storing memory embedding:', error);
  }

  return { id: memory.id, userId, type, content, metadata };
}

export async function retrieveRelevantMemories(userId, query, topK = 5) {
  try {
    const embedding = await generateEmbedding(query);
    if (!embedding) {
      // No embedding provider — fall back to recent memories from DB
      const memories = await prisma.memory.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: topK,
        select: { content: true },
      });
      return memories.map((m) => m.content);
    }

    const collection = await getOrCreateCollection(userId);
    const results = await searchMemories(collection, embedding, topK);

    if (!results.ids || results.ids.length === 0 || !results.ids[0].length) {
      return [];
    }

    const memories = await prisma.memory.findMany({
      where: { id: { in: results.ids[0] }, userId },
      select: { content: true },
    });

    return memories.map((m) => m.content);
  } catch (error) {
    logger.error('Error retrieving memories:', error);
    return [];
  }
}

export async function getUserMemories(userId, type = null, limit = 50) {
  return prisma.memory.findMany({
    where: type ? { userId, type } : { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function deleteMemory(userId, memoryId) {
  const memory = await prisma.memory.findFirst({
    where: { id: memoryId, userId },
  });

  if (!memory) {
    return false;
  }

  try {
    const collection = await getOrCreateCollection(userId);
    await deleteMemoryEmbedding(collection, memoryId);
  } catch (error) {
    logger.error('Error deleting memory embedding:', error);
  }

  await prisma.memory.delete({ where: { id: memoryId } });
  logger.info(`Memory deleted: ${memoryId}`);
  return true;
}

export async function getConversationHistory(userId, limit = 10) {
  const messages = await prisma.message.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { role: true, content: true },
  });

  return messages.reverse();
}

export async function storeMessage(userId, role, content) {
  const message = await prisma.message.create({
    data: { userId, role, content },
  });
  return { id: message.id, userId, role, content };
}
