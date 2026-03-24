import { prisma } from '../config/database.js';
import { checkChromaConnection } from '../config/chroma.js';
import { checkWAHAConnection } from '../config/waha.js';
import { getLLMConfig } from '../services/openai.js';

export async function healthCheck(req, res) {
  const services = {
    database: false,
    chroma: false,
    waha: false,
    llm: false,
  };

  const llmConfig = getLLMConfig();

  try {
    await prisma.$queryRaw`SELECT 1`;
    services.database = true;
  } catch (error) {
    console.error('Database health check failed:', error);
  }
  
  try {
    services.chroma = await checkChromaConnection();
  } catch (error) {
    console.error('Chroma health check failed:', error);
  }
  
  try {
    services.waha = await checkWAHAConnection();
  } catch (error) {
    console.error('WAHA health check failed:', error);
  }
  
  try {
    if (llmConfig.isLocal) {
      try {
        const response = await fetch(`${llmConfig.url}/health`, { 
          method: 'GET',
          signal: AbortSignal.timeout(5000)
        });
        services.llm = response.ok;
      } catch (e) {
        services.llm = llmConfig.url.includes('host.docker.internal');
      }
    } else {
      services.llm = !!process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your-openai-api-key-here';
    }
  } catch (error) {
    console.error('LLM health check failed:', error);
    services.llm = false;
  }
  
  const criticalHealthy = services.database && services.chroma && services.waha;
  
  res.status(criticalHealthy ? 200 : 503).json({
    status: criticalHealthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    services,
    llm: llmConfig,
  });
}
