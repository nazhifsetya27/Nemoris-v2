import * as chrono from 'chrono-node';

const INDONESIAN_PATTERNS = {
  reminder: [
    /ingatkan saya untuk\s+(.+)/i,
    /ingatkan saya\s+(.+?)\s+pukul\s+(.+)/i,
    /jangan lupa\s+(.+)/i,
    /bikin reminder untuk\s+(.+)/i,
    /pasang alarm\s+(.+)/i,
    /inget\s+(.+)/i,
    /tolong ingetin\s+(.+)/i,
    / reminder\s+(.+)/i,
  ],
  memory: [
    /ingat (?:bahwa |)(.+)/i,
    /simpan\s+(.+)/i,
    /catat\s+(.+)/i,
    /记住了\s+(.+)/i,
    /ingat:\s*(.+)/i,
    /data saya:\s*(.+)/i,
  ],
  keywords: {
    reminder: ['ingatkan', 'reminder', 'alarm', 'inget', 'jangan lupa', 'bikin reminder'],
    memory: ['ingat', 'simpan', 'catat', 'record', 'note that'],
  }
};

const ENGLISH_PATTERNS = {
  reminder: [
    /remind me to\s+(.+)/i,
    /remind me\s+(.+?)\s+at\s+(.+)/i,
    /remember to\s+(.+)/i,
    /don't forget to\s+(.+)/i,
    /don't forget\s+(.+)/i,
    /remind me about\s+(.+)/i,
    /set a reminder to\s+(.+)/i,
    /alert me\s+(.+)/i,
  ],
  memory: [
    /remember (?:that |)(.+)/i,
    /my\s+(\w+)\s+is\s+(.+)/i,
    /i'm\s+(.+)/i,
    /i have\s+(.+)/i,
    /my\s+(\w+):\s*(.+)/i,
    /note that\s+(.+)/i,
    /remember,?\s+(.+)/i,
  ],
};

export const INTENT_PATTERNS = {
  reminder: [...ENGLISH_PATTERNS.reminder, ...INDONESIAN_PATTERNS.reminder],
  memory: [...ENGLISH_PATTERNS.memory, ...INDONESIAN_PATTERNS.memory],
};

const ID_TIME_WORDS = {
  'pagi': { hours: 0, modifier: 12 },
  'pagi hari': { hours: 8, modifier: 0 },
  'siang': { hours: 12, modifier: 0 },
  'sore': { hours: 15, modifier: 0 },
  'malam': { hours: 18, modifier: 0 },
  'mlm': { hours: 18, modifier: 0 },
  'subuh': { hours: 4, modifier: 0 },
  'tengah malam': { hours: 0, modifier: 0 },
};

const ID_DATE_WORDS = {
  'hari ini': 'today',
  'besok': 'tomorrow',
  'lusa': 'in 2 days',
  'minggu ini': 'this week',
  'bulan ini': 'this month',
  'tgl': '',
  'tanggal': '',
};

function detectLanguage(text) {
  const idIndicators = ['ingatkan', 'ingat', 'jangan lupa', 'simpan', 'catat', 'pagi', 'siang', 'sore', 'malam', 'besok', 'lusa', 'minggu', 'bulan'];
  const lowerText = text.toLowerCase();
  
  let idScore = 0;
  for (const word of idIndicators) {
    if (lowerText.includes(word)) idScore++;
  }
  
  return idScore >= 1 ? 'id' : 'en';
}

function parseIndonesianDateTime(text) {
  let processedText = text.toLowerCase();
  
  for (const [idWord, enWord] of Object.entries(ID_DATE_WORDS)) {
    processedText = processedText.replace(new RegExp(idWord, 'gi'), enWord);
  }
  
  for (const [idTime, config] of Object.entries(ID_TIME_WORDS)) {
    if (processedText.includes(idTime)) {
      return { timeWord: idTime, config };
    }
  }
  
  return null;
}

export function detectIntent(text) {
  const language = detectLanguage(text);
  
  for (const pattern of INTENT_PATTERNS.reminder) {
    const match = text.match(pattern);
    if (match) {
      return {
        intent: 'reminder',
        match: match,
        raw: match[0],
        language: language,
      };
    }
  }
  
  for (const pattern of INTENT_PATTERNS.memory) {
    const match = text.match(pattern);
    if (match) {
      return {
        intent: 'memory',
        match: match,
        raw: match[0],
        language: language,
      };
    }
  }
  
  return {
    intent: 'question',
    match: null,
    raw: text,
    language: language,
  };
}

export function parseReminder(text, language = 'en') {
  const results = {
    task: null,
    datetime: null,
    recurrence: null,
  };

  let processedText = text;
  
  if (language === 'id') {
    const idParse = parseIndonesianDateTime(text);
    if (idParse) {
      processedText = text.toLowerCase().replace(idParse.timeWord, `${idParse.config.hours}:00`);
    }
    
    for (const [idWord, enWord] of Object.entries(ID_DATE_WORDS)) {
      processedText = processedText.replace(new RegExp(idWord, 'gi'), enWord);
    }
  }

  const parsed = chrono.parse(processedText, new Date(), { forwardDate: true });
  
  if (parsed.length > 0) {
    results.datetime = parsed[0].start.date();
    
    const remainingText = processedText.replace(parsed[0].text, '').trim();
    
    const enPrefixes = /(?:to|about|that|)\s*/i;
    const idPrefixes = /(?:untuk|untuk|that|)\s*/i;
    const prefixes = language === 'id' ? idPrefixes : enPrefixes;
    
    const taskMatch = remainingText.match(prefixes);
    results.task = taskMatch ? remainingText.replace(prefixes, '').trim() : remainingText;
  } else {
    const timeMatch = processedText.match(/at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
    if (timeMatch) {
      const prefixPatterns = language === 'id' 
        ? /ingatkan saya untuk|ingatkan saya|bikin reminder|pasang alarm|inget/i
        : /remind me to|remind me|remember to/i;
      
      results.task = processedText.replace(timeMatch[0], '').replace(prefixPatterns, '').trim();
      
      const today = new Date();
      const [time, period] = timeMatch[1].split(' ');
      let [hours, minutes] = time.split(':').map(Number);
      
      if (period?.toLowerCase() === 'pm' && hours < 12) hours += 12;
      if (period?.toLowerCase() === 'am' && hours === 12) hours = 0;
      
      results.datetime = new Date(today.setHours(hours, minutes || 0, 0, 0));
    }
  }

  const recurrencePatterns = {
    en: { daily: /daily|every day/i, weekly: /weekly|every week/i, monthly: /monthly|every month/i },
    id: { daily: /harian|setiap hari/i, weekly: /mingguan|setiap minggu/i, monthly: /bulanan|setiap bulan/i },
  };
  
  const recPatterns = recurrencePatterns[language] || recurrencePatterns.en;
  
  if (recPatterns.daily.test(text)) {
    results.recurrence = 'daily';
  } else if (recPatterns.weekly.test(text)) {
    results.recurrence = 'weekly';
  } else if (recPatterns.monthly.test(text)) {
    results.recurrence = 'monthly';
  }
  
  return results;
}

export function parseMemory(text, language = 'en') {
  const results = {
    type: 'fact',
    content: text,
    metadata: {},
  };
  
  const preferencePatterns = {
    en: /prefer|like|don't like|dislike|hate|love/i,
    id: /suka|tidak suka|anti|gemar|benci|malas/i,
  };
  
  const eventPatterns = {
    en: /meeting|event|appointment/i,
    id: /rapat|pertemuan|acara|jadwal|appointment/i,
  };
  
  const prefPattern = preferencePatterns[language] || preferencePatterns.en;
  const evtPattern = eventPatterns[language] || eventPatterns.en;
  
  if (prefPattern.test(text)) {
    results.type = 'preference';
  } else if (evtPattern.test(text)) {
    results.type = 'event';
  }
  
  const datePatterns = [
    /(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{2,4})/i,
    /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{2,4})/i,
    /(\d{4}-\d{2}-\d{2})/,
    /(\d{1,2}\s+\w+\s+\d{4})/i,
    /(\d{1,2}\/\d{1,2}\/\d{2,4})/,
  ];
  
  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match) {
      results.metadata.date = match[1];
      break;
    }
  }
  
  return results;
}

export function getResponseTemplates(language = 'en') {
  const templates = {
    en: {
      welcome: "Hi! I'm Nemoris, your personal AI memory assistant.\n\nI can help you:\n📝 Remember facts and preferences\n⏰ Set reminders\n💬 Answer questions based on what you've told me\n\nJust chat with me naturally!",
      reminderSet: "✅ Reminder set!\n\n\"{task}\"\nDue: {time}",
      reminderRecurrence: " ({recurrence})",
      memoryStored: "✅ I've remembered that! {summary}",
      memoryStoredDefault: "✅ I've stored that in my memory!",
      error: "I'm sorry, I encountered an error. Please try again.",
      reminderError: "I couldn't understand the reminder. Please try: 'Remind me to [task] at [time]'",
      clarification: "Could you clarify? For example: 'Remind me to pay bill at 3pm' or 'Ingatkan saya untuk bayar tagihan jam 3 sore'",
    },
    id: {
      welcome: "Halo! Saya Nemoris, asisten AI memory personal Anda.\n\nSaya bisa membantu Anda:\n📝 Mengingat fakta dan preferensi\n⏰ Mengatur pengingat\n💬 Menjawab pertanyaan berdasarkan yang sudah Anda beritahu\n\nSilakan chat dengan saya secara alami!",
      reminderSet: "✅ Pengingat sudah diatur!\n\n\"{task}\"\nWaktunya: {time}",
      reminderRecurrence: " ({recurrence})",
      memoryStored: "✅ Saya sudah mengingat itu! {summary}",
      memoryStoredDefault: "✅ Saya sudah menyimpan itu di memory!",
      error: "Maaf, saya mengalami kesalahan. Silakan coba lagi.",
      reminderError: "Saya tidak mengerti pengingatnya. Coba: 'Ingatkan saya untuk [task] jam [waktu]' atau 'Remind me to [task] at [time]'",
      clarification: "Bisa diperjelas? Contoh: 'Ingatkan saya untuk bayar tagihan jam 3 sore' atau 'Remind me to pay bill at 3pm'",
    },
  };
  
  return templates[language] || templates.en;
}
