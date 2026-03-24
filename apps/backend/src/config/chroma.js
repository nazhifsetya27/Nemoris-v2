import { ChromaClient } from 'chromadb';

let client = null;
let collection = null;

export function getChromaClient() {
  if (!client) {
    const chromaUrl = process.env.CHROMA_URL || 'http://localhost:8000';
    client = new ChromaClient({ path: chromaUrl });
  }
  return client;
}

export async function getOrCreateCollection(userId) {
  const chromaClient = getChromaClient();
  const collectionName = `memory_${userId}`;
  
  try {
    collection = await chromaClient.getOrCreateCollection({ name: collectionName });
    return collection;
  } catch (error) {
    console.error('Error creating Chroma collection:', error);
    throw error;
  }
}

export async function addMemoryEmbedding(collection, memoryId, content, embedding) {
  try {
    await collection.add({
      ids: [memoryId],
      embeddings: [embedding],
      documents: [content],
      metadatas: [{ memoryId, content }],
    });
    return true;
  } catch (error) {
    console.error('Error adding embedding to Chroma:', error);
    throw error;
  }
}

export async function searchMemories(collection, queryEmbedding, topK = 5) {
  try {
    const results = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: topK,
    });
    return results;
  } catch (error) {
    console.error('Error searching Chroma:', error);
    return { ids: [], documents: [], metadatas: [] };
  }
}

export async function deleteMemoryEmbedding(collection, memoryId) {
  try {
    await collection.delete({ ids: [memoryId] });
    return true;
  } catch (error) {
    console.error('Error deleting embedding from Chroma:', error);
    return false;
  }
}

export async function checkChromaConnection() {
  try {
    const chromaClient = getChromaClient();
    await chromaClient.heartbeat();
    return true;
  } catch (error) {
    console.error('Chroma connection failed:', error);
    return false;
  }
}
