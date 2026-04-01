import axios from 'axios';
import { logger } from '../utils/logger.js';

const WAHA_URL = process.env.WAHA_URL || 'http://localhost:4130';
const WAHA_SESSION = process.env.WAHA_SESSION || 'default';
const WAHA_API_KEY = process.env.WAHA_API_KEY || '';

const wahaClient = axios.create({
  baseURL: WAHA_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    ...(WAHA_API_KEY && { 'X-Api-Key': WAHA_API_KEY }),
  },
});

const messageQueue = [];
let isProcessingQueue = false;
const MIN_MESSAGE_DELAY = parseInt(process.env.MIN_MESSAGE_DELAY) || 3000;
const MAX_MESSAGE_DELAY = parseInt(process.env.MAX_MESSAGE_DELAY) || 8000;

function getRandomDelay() {
  return Math.floor(Math.random() * (MAX_MESSAGE_DELAY - MIN_MESSAGE_DELAY + 1)) + MIN_MESSAGE_DELAY;
}

async function processQueue() {
  if (isProcessingQueue || messageQueue.length === 0) return;
  
  isProcessingQueue = true;
  
  while (messageQueue.length > 0) {
    const { chatId, text, resolve, reject } = messageQueue.shift();
    
    try {
      await wahaClient.post(`/api/sendText`, {
        session: WAHA_SESSION,
        chatId: chatId,
        text: text,
      });
      
      const delay = getRandomDelay();
      await new Promise(r => setTimeout(r, delay));
      
      resolve(true);
    } catch (error) {
      console.error('Queue message send error:', error.response?.data || error.message);
      reject(error);
    }
  }
  
  isProcessingQueue = false;
}

export async function sendWhatsAppMessage(chatId, text) {
  return new Promise((resolve, reject) => {
    messageQueue.push({ chatId, text, resolve, reject });
    processQueue();
  });
}

export async function sendWhatsAppMessageImmediate(chatId, text) {
  try {
    const response = await wahaClient.post(`/api/sendText`, {
      session: WAHA_SESSION,
      chatId: chatId,
      text: text,
    });
    return response.data;
  } catch (error) {
    console.error('Error sending WhatsApp message:', error.response?.data || error.message);
    throw error;
  }
}

export async function sendWhatsAppMessageWithButtons(chatId, text, buttons) {
  return new Promise((resolve, reject) => {
    messageQueue.push({
      chatId,
      text,
      resolve,
      reject,
      isButtons: true,
      buttons
    });
    processQueue();
  });
}

export async function sendWhatsAppMessageWithButtonsImmediate(chatId, text, buttons) {
  try {
    const response = await wahaClient.post(`/api/sendButtons`, {
      session: WAHA_SESSION,
      chatId: chatId,
      text: text,
      buttons: buttons,
    });
    return response.data;
  } catch (error) {
    console.error('Error sending WhatsApp message with buttons:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Resolve a LID JID (e.g. 204917302104303@lid) to a phone JID via WAHA.
 * @param {string} lidJid - Full sender id including @lid
 * @returns {Promise<string|null>} Phone JID (e.g. 628123@c.us) or null
 */
export async function getPhoneNumberFromLid(lidJid) {
  try {
    const response = await wahaClient.get(
      `/api/${WAHA_SESSION}/lids/${encodeURIComponent(lidJid)}`
    );
    return response.data?.pn || null;
  } catch (error) {
    logger.error(
      '[WAHA] Failed to get phone number from LID:',
      error.response?.data || error.message
    );
    return null;
  }
}

export async function getContact(chatId) {
  try {
    if (chatId?.includes('@lid')) {
      const pn = await getPhoneNumberFromLid(chatId);
      if (pn) {
        return { id: pn, pushName: null };
      }
      return null;
    }
    
    const response = await wahaClient.get(`/api/contacts`, {
      params: {
        session: WAHA_SESSION,
        chatId: chatId,
      },
    });
    return response.data;
  } catch (error) {
    console.error('Error getting contact:', error.response?.data || error.message);
    return null;
  }
}

export async function getContactByPhone(phone) {
  try {
    const response = await wahaClient.get(`/api/contacts/check-exists`, {
      params: {
        session: WAHA_SESSION,
        phone: phone,
      },
    });
    return response.data;
  } catch (error) {
    console.error('Error checking phone:', error.response?.data || error.message);
    return null;
  }
}

export async function checkWAHAConnection() {
  try {
    const response = await wahaClient.get(`/api/sessions/${WAHA_SESSION}`);
    const status = response.data?.status || response.data?.sessionStatus;
    console.log('WAHA status:', status);
    return status === 'LOADED' || status === 'WORKING' || status === 'SCAN_QR_CODE';
  } catch (error) {
    console.error('WAHA connection failed:', error.message);
    return false;
  }
}

export function getWAHAUrl() {
  return WAHA_URL;
}

export function getWAHASession() {
  return WAHA_SESSION;
}

export function getQueueStatus() {
  return {
    queueLength: messageQueue.length,
    isProcessing: isProcessingQueue,
  };
}
