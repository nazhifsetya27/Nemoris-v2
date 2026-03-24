import express from 'express';
import { handleIncomingMessage } from '../handlers/message.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const payload = req.body;
    
    logger.info('Webhook received:', JSON.stringify(payload, null, 2));
    
    const event = payload.event || payload.payload?.event;
    
    if (event === 'message') {
      const message = payload.payload || payload;
      
      logger.info('Full payload:', JSON.stringify(payload, null, 2));
      logger.info('Message payload:', JSON.stringify(message, null, 2));
      logger.info('Message keys:', Object.keys(message));
      
      if (message.fromMe) {
        logger.info('Ignoring message from self');
        return res.status(200).send('OK');
      }
      
      const text = message.text || message.content || message.body || '';
      
      if (!text) {
        logger.info('Ignoring non-text message');
        return res.status(200).send('OK');
      }
      
      await handleIncomingMessage({
        id: message.id,
        from: message.from,
        text: text,
      });
    }
    
    res.status(200).send('OK');
  } catch (error) {
    logger.error('Webhook error:', error);
    res.status(500).send('Error');
  }
});

export default router;
