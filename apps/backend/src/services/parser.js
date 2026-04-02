import * as chrono from 'chrono-node';
import { detectAll } from 'tinyld';
import { logger } from '../utils/logger.js';

// ─── Phase 1: Pronoun Normalization ───────────────────────────────────────────

const PRONOUN_MAP_FIRST = /\b(?:gue|gw|gua|gwa|aku|ane|ana)\b/gi;
const PRONOUN_MAP_SECOND = /\b(?:lu|lo|elu|elo|kamu|km)\b/gi;

/** Normalize informal Indonesian pronouns to standard "saya"/"kamu" for pattern matching. */
export function normalizePronouns(text) {
  return text
    .replace(PRONOUN_MAP_FIRST, 'saya')
    .replace(PRONOUN_MAP_SECOND, 'kamu');
}

// ─── Phase 1b: Slang & Abbreviation Normalization ─────────────────────────────

/**
 * Dictionary: Indonesian slang/abbreviation → standard form.
 * Add new entries here — no other code changes needed.
 */
const SLANG_DICTIONARY = {
  // Time units (critical for reminder parsing)
  'mnt': 'menit', 'mnit': 'menit', 'mnt': 'menit',
  'dtk': 'detik', 'dtik': 'detik',
  'jm': 'jam',
  'hr': 'hari',

  // Date/period
  'hr ini': 'hari ini', 'hri ini': 'hari ini',
  'mlm ini': 'malam ini',
  'bsk': 'besok', 'bsok': 'besok',
  'skrg': 'sekarang', 'skrng': 'sekarang', 'skg': 'sekarang',
  'ntr': 'nanti', 'ntar': 'nanti', 'nnt': 'nanti', 'nnti': 'nanti',
  'mlm': 'malam', 'pg': 'pagi', 'pgi': 'pagi',
  'mgg dpn': 'minggu depan', 'mgg': 'minggu',
  'bln dpn': 'bulan depan', 'bln': 'bulan',
  'dpn': 'depan', 'thn': 'tahun',

  // Prepositions / connectors
  'buay': 'untuk', 'buat': 'untuk', 'bt': 'untuk', 'utk': 'untuk', 'untk': 'untuk',
  'spy': 'supaya', 'sm': 'sama', 'dr': 'dari',
  'dg': 'dengan', 'dgn': 'dengan', 'dngn': 'dengan',

  // Common verbs (reminder-relevant)
  'bljar': 'belajar', 'bljr': 'belajar', 'blajar': 'belajar',
  'krja': 'kerja', 'krj': 'kerja',
  'mkn': 'makan', 'mnum': 'minum', 'mnm': 'minum',
  'tdur': 'tidur', 'tdr': 'tidur',
  'byr': 'bayar', 'bli': 'beli',
  'tlp': 'telepon', 'telp': 'telepon', 'tlfn': 'telepon',
  'krm': 'kirim', 'krim': 'kirim',
  'ambl': 'ambil', 'jmpt': 'jemput', 'jmput': 'jemput',
  'anterin': 'antarkan', 'antrin': 'antarkan',

  // Polite / command
  'tlong': 'tolong', 'tlg': 'tolong', 'tlng': 'tolong',
  'plz': 'tolong', 'pls': 'tolong', 'mhon': 'mohon',

  // Negation
  'gk': 'tidak', 'gak': 'tidak', 'tdk': 'tidak',
  'ngga': 'tidak', 'nggak': 'tidak', 'kagak': 'tidak',
  'enggak': 'tidak', 'engga': 'tidak',

  // Common nouns
  'tgs': 'tugas', 'obt': 'obat', 'rmh': 'rumah',
  'kntr': 'kantor', 'kntor': 'kantor',
  'sklh': 'sekolah', 'sklah': 'sekolah', 'kmpus': 'kampus',
};

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Pre-compiled patterns: multi-word first, then longest single-word first. */
const SLANG_PATTERNS = Object.entries(SLANG_DICTIONARY)
  .sort((a, b) => {
    const aMulti = a[0].includes(' ') ? 1 : 0;
    const bMulti = b[0].includes(' ') ? 1 : 0;
    if (aMulti !== bMulti) return bMulti - aMulti;
    return b[0].length - a[0].length;
  })
  .map(([slang, standard]) => ({
    pattern: slang.length <= 2
      ? new RegExp(`(?<=^|\\s)${escapeRegex(slang)}(?=\\s|$)`, 'gi')
      : new RegExp(`\\b${escapeRegex(slang)}\\b`, 'gi'),
    standard,
  }));

/** Expand Indonesian slang/abbreviations to standard forms. */
export function normalizeSlang(text) {
  let result = text;
  for (const { pattern, standard } of SLANG_PATTERNS) {
    result = result.replace(pattern, standard);
  }
  return result;
}

/**
 * Full normalization pipeline: lowercase → pronouns → slang.
 * Use this everywhere instead of calling normalizePronouns directly.
 */
export function normalizeText(text) {
  let result = text.toLowerCase();
  result = normalizePronouns(result);
  result = normalizeSlang(result);
  return result;
}

// ─── Intent Patterns ──────────────────────────────────────────────────────────

const INDONESIAN_PATTERNS = {
  reminder: [
    /ingatkan saya untuk\s+(.+)/i,
    /ingatkan saya\s+(.+?)\s+(?:pukul|jam)\s+(.+)/i,
    /ingatkan\s+(?:saya\s+)?(.+)/i,
    /jangan lupa\s+(.+)/i,
    /bikin reminder\s+(?:untuk\s+)?(.+)/i,
    /pasang alarm\s+(.+)/i,
    /inget(?:in|kan)?\s+(?:saya\s+)?(.+)/i,
    /tolong ingetin\s+(.+)/i,
    /reminder\s+(.+)/i,
    // Time-first: "jam 3 beli susu", "nanti siang telepon ibu"
    /(?:ntar|nanti|nt)\s+(?:ingetin|ingatkan)\s+(.+)/i,
  ],
  memory: [
    // Explicit store commands
    /ingat (?:bahwa\s+)?(.+)/i,
    /simpan\s+(.+)/i,
    /catat\s+(.+)/i,
    /ingat:\s*(.+)/i,
    /data saya:\s*(.+)/i,

    // Fact: "X saya namanya/adalah/itu Y"
    /\w+ saya (?:namanya|adalah|itu)\s+(.+)/i,
    // "nama X saya Y"
    /nama\s+\w*\s*saya\s+(.+)/i,
    // "saya tinggal/kerja/lahir di X"
    /saya (?:tinggal|kerja|bekerja|lahir|sekolah|kuliah) di\s+(.+)/i,
    // "saya punya X"
    /saya punya\s+(.+)/i,
    // "saya alergi/suka/benci X"
    /saya (?:alergi|suka|benci|gemar|hobi|senang|doyan)\s+(.+)/i,
    // "umur/usia saya X"
    /(?:umur|usia) saya\s+(.+)/i,
    // "ulang tahun saya X"
    /ulang tahun saya\s+(.+)/i,
    // "tanggal X saya Y"
    /tanggal\s+\w+\s+saya\s+(.+)/i,
    // "saya lahir/tinggal X"
    /saya (?:lahir|tinggal)\s+(.+)/i,
    // Family size: "saya 4 bersaudara"
    /saya\s+\d+\s+(?:bersaudara|orang)/i,
    // Relations: "adik/pacar/ibu saya X"
    /(?:adik|kakak|pacar|kekasih|ibu|ayah|mama|papa|bapak|nenek|kakek|om|tante|suami|istri|anak|abang|mbak|mas) saya\s+(.+)/i,
    // Favorites: "makanan favorit saya X"
    /(?:makanan|minuman|warna|film|lagu|buku|game|hobi|acara|tempat)\s+(?:favorit|kesukaan|fav)\s+saya\s+(.+)/i,
    // "favorit saya X"
    /(?:favorit|kesukaan|fav) saya\s+(.+)/i,
    // Third-person facts: "dia namanya/tinggal/kerja X"
    /(?:dia|doi|dy)\s+(?:namanya|tinggal|kerja|lahir|umurnya)\s+(.+)/i,
  ],
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
    /remember (?:that\s+)?(.+)/i,
    /my\s+(\w+)\s+is\s+(.+)/i,
    /my\s+\w+(?:'s)?\s+name is\s+(.+)/i,
    /i'm\s+(.+)/i,
    /i have\s+(.+)/i,
    /my\s+(\w+):\s*(.+)/i,
    /note that\s+(.+)/i,
    /i (?:live|work|was born) in\s+(.+)/i,
    /i'm allergic to\s+(.+)/i,
    /my\s+(?:birthday|anniversary)\s+is\s+(.+)/i,
    /i was born\s+(.+)/i,
  ],
};

export const INTENT_PATTERNS = {
  reminder: [...ENGLISH_PATTERNS.reminder, ...INDONESIAN_PATTERNS.reminder],
  memory: [...ENGLISH_PATTERNS.memory, ...INDONESIAN_PATTERNS.memory],
};

/**
 * Strong patterns — high confidence, checked BEFORE question guard.
 * If these match, the intent is returned even if the text ends with "?".
 */
const STRONG_REMINDER_PATTERNS = INTENT_PATTERNS.reminder;

const STRONG_MEMORY_PATTERNS = [
  // EN
  /remember that\s+(.+)/i,
  /note that\s+(.+)/i,
  /my\s+(\w+)\s+is\s+(.+)/i,
  /my\s+(\w+):\s*(.+)/i,
  /my\s+\w+(?:'s)?\s+name is\s+(.+)/i,
  /i (?:live|work|was born) in\s+(.+)/i,
  /i'm allergic to\s+(.+)/i,
  /my\s+(?:birthday|anniversary)\s+is\s+(.+)/i,
  /i was born\s+(.+)/i,
  // ID
  /simpan\s+(.+)/i,
  /catat\s+(.+)/i,
  /ingat:\s*(.+)/i,
  /data saya:\s*(.+)/i,
  /ingat bahwa\s+(.+)/i,
  /\w+ saya (?:namanya|adalah|itu)\s+(.+)/i,
  /nama\s+\w*\s*saya\s+(.+)/i,
  /saya (?:tinggal|kerja|bekerja|lahir|sekolah|kuliah) di\s+(.+)/i,
  /saya punya\s+(.+)/i,
  /saya (?:alergi|suka|benci|gemar|hobi|senang|doyan)\s+(.+)/i,
  /(?:umur|usia) saya\s+(.+)/i,
  /ulang tahun saya\s+(.+)/i,
  /tanggal\s+\w+\s+saya\s+(.+)/i,
  /saya (?:lahir|tinggal)\s+(.+)/i,
  /saya\s+\d+\s+(?:bersaudara|orang)/i,
  /(?:adik|kakak|pacar|kekasih|ibu|ayah|mama|papa|bapak|nenek|kakek|om|tante|suami|istri|anak|abang|mbak|mas) saya\s+(.+)/i,
  /(?:makanan|minuman|warna|film|lagu|buku|game|hobi|acara|tempat)\s+(?:favorit|kesukaan|fav)\s+saya\s+(.+)/i,
  /(?:favorit|kesukaan|fav) saya\s+(.+)/i,
  /(?:dia|doi|dy)\s+(?:namanya|tinggal|kerja|lahir|umurnya)\s+(.+)/i,
];

// ─── Time & Date Config ───────────────────────────────────────────────────────

const ID_TIME_WORDS = {
  'pagi hari': { hours: 8, modifier: 0 },
  'tengah malam': { hours: 0, modifier: 0 },
  'subuh': { hours: 4, modifier: 0 },
  'pagi': { hours: 8, modifier: 0 },
  'siang': { hours: 12, modifier: 0 },
  'sore': { hours: 15, modifier: 0 },
  'malam': { hours: 19, modifier: 0 },
  'mlm': { hours: 19, modifier: 0 },
};

const ID_DATE_WORDS = {
  'hari ini': 'today',
  'besok': 'tomorrow',
  'lusa': 'in 2 days',
  'minggu depan': 'next week',
  'bulan depan': 'next month',
  'minggu ini': 'this week',
  'bulan ini': 'this month',
};

// ─── Language Detection ───────────────────────────────────────────────────────

export function detectLanguage(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return 'en';

  const candidates = detectAll(trimmed)
    .filter((x) => x.lang === 'en' || x.lang === 'id')
    .sort((a, b) => b.accuracy - a.accuracy);

  if (candidates.length === 0) return 'en';
  return candidates[0].lang === 'id' ? 'id' : 'en';
}

// ─── Question Detection ───────────────────────────────────────────────────────

const QUESTION_PREFIX = /^(?:can you|could you|do you|will you|would you|are you|is it|does |what|how|why|where|when|who|apakah|bisakah|bisa kah|apa |bagaimana|kenapa|kapan|dimana|siapa)\b/i;
const QUESTION_SUFFIX = /\?$/;

function isLikelyQuestion(text) {
  const trimmed = text.trim();
  return QUESTION_PREFIX.test(trimmed) || QUESTION_SUFFIX.test(trimmed);
}

// ─── Phase 2: Intent Classification (3-tier ready) ────────────────────────────

function matchPatterns(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match;
  }
  return null;
}

/**
 * Tier 1: High-confidence lexical fast-path.
 * Strong patterns always win, even if text looks like a question.
 * Returns null when no confident match.
 */
export function tryIntentLexicalFastPath(text) {
  const language = detectLanguage(text);
  const normalized = normalizeText(text);
  const trimmed = normalized.trim();
  if (!trimmed) return null;

  // Strong patterns win regardless of question markers
  const reminderMatch = matchPatterns(trimmed, STRONG_REMINDER_PATTERNS);
  if (reminderMatch) {
    return { intent: 'reminder', match: reminderMatch, raw: reminderMatch[0], language, source: 'lexical' };
  }

  const memoryMatch = matchPatterns(trimmed, STRONG_MEMORY_PATTERNS);
  if (memoryMatch) {
    return { intent: 'memory', match: memoryMatch, raw: memoryMatch[0], language, source: 'lexical' };
  }

  return null;
}

/**
 * Tier 1 fallback: weaker patterns, blocked by question guard.
 * Returns null when uncertain (routes to Tier 2/3).
 */
export function detectIntent(text) {
  const language = detectLanguage(text);
  logger.info('Detected language:', language);

  const normalized = normalizeText(text);
  const trimmed = normalized.trim();

  // Question guard — block weaker patterns
  if (isLikelyQuestion(trimmed)) {
    return { intent: 'question', match: null, raw: text, language, source: 'lexical' };
  }

  // 3. Weaker patterns (broader, more false-positive prone)
  const weakReminder = matchPatterns(trimmed, INTENT_PATTERNS.reminder);
  if (weakReminder) {
    return { intent: 'reminder', match: weakReminder, raw: weakReminder[0], language, source: 'lexical' };
  }

  const weakMemory = matchPatterns(trimmed, INTENT_PATTERNS.memory);
  if (weakMemory) {
    return { intent: 'memory', match: weakMemory, raw: weakMemory[0], language, source: 'lexical' };
  }

  // 4. Return null = uncertain → let Tier 2/3 decide
  return null;
}

// ─── Phase 4: Heuristic Scoring ───────────────────────────────────────────────

const TIME_HINT_WORDS = /\b(?:jam|pukul|menit|detik|nanti|besok|lusa|minggu depan|bulan depan|siang|sore|malam|pagi|subuh|at \d|tomorrow|tonight|today|in \d+ (?:min|hour|day))\b/i;
const RELATION_WORDS = /\b(?:adik|kakak|pacar|kekasih|ibu|ayah|mama|papa|bapak|nenek|kakek|om|tante|suami|istri|anak|abang|mbak|mas|saudara|teman|sahabat|bos|guru|dosen|mantan)\b/i;
const FACT_VERBS = /\b(?:namanya|adalah|itu|bernama|tinggal di|kerja di|lahir|umurnya|bekerja)\b/i;
const PERSONAL_PRONOUNS = /\b(?:saya|dia|doi|dy|mereka)\b/i;

/**
 * Tier 2: Heuristic scoring with optional conversation context.
 * @param {string} text - normalized text
 * @param {string} language
 * @param {{ lastBotAction?: string, pendingSlot?: string }|null} context
 * @returns {{ intent: string, language: string, source: string }|null}
 */
export function scoreIntentHeuristic(text, language, context = null) {
  const normalized = normalizeText(text);

  const scores = { reminder: 0, memory: 0, question: 0 };

  // Text signals
  if (TIME_HINT_WORDS.test(normalized)) scores.reminder += 3;
  if (PERSONAL_PRONOUNS.test(normalized)) scores.memory += 2;
  if (RELATION_WORDS.test(normalized)) scores.memory += 2;
  if (FACT_VERBS.test(normalized)) scores.memory += 2;
  if (isLikelyQuestion(normalized)) scores.question += 3;

  // Short declarative (< 6 words, no "?", not a greeting)
  const words = normalized.split(/\s+/);
  const isShort = words.length <= 6 && !QUESTION_SUFFIX.test(normalized);
  const GREETINGS = /^(?:hai|halo|hello|hi|hey|hei|p|woi|oy|yo)\b/i;
  if (isShort && !GREETINGS.test(normalized)) {
    // Could be a follow-up answer
    scores.memory += 1;
  }

  // Context-based boosting (Phase 3)
  if (context) {
    if (context.lastBotAction === 'asked_info' || context.pendingSlot === 'person_name') {
      scores.memory += 4;
    }
    if (context.lastBotAction === 'reminder_error' || context.pendingSlot === 'reminder_time') {
      scores.reminder += 4;
    }
  }

  // Find winner
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topIntent, topScore] = sorted[0];
  const [, runnerUpScore] = sorted[1];

  // Confident if top >= 4 and leads by >= 2
  if (topScore >= 4 && topScore - runnerUpScore >= 2) {
    return { intent: topIntent, match: null, raw: text, language, source: 'heuristic' };
  }

  return null; // Ambiguous → route to Tier 3
}

// ─── Phase 6: Time Parsing ────────────────────────────────────────────────────

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

export function parseReminder(text, language = 'en') {
  const results = { task: null, datetime: null, recurrence: null };

  let processedText = normalizeText(text);

  if (language === 'id') {
    // Relative time: "X menit/jam/detik/hari lagi"
    processedText = processedText.replace(/(\d+)\s*menit\s*lagi/gi, 'in $1 minutes');
    processedText = processedText.replace(/(\d+)\s*jam\s*lagi/gi, 'in $1 hours');
    processedText = processedText.replace(/(\d+)\s*detik\s*lagi/gi, 'in $1 seconds');
    processedText = processedText.replace(/(\d+)\s*hari\s*lagi/gi, 'in $1 days');
    processedText = processedText.replace(/setengah\s*jam\s*lagi/gi, 'in 30 minutes');

    // "jam X" / "pukul X" → "at X:00" (resolve explicit clock times FIRST)
    // Context: check if text has a period hint nearby (pagi/siang/sore/malam)
    const hasPeriodHint = /(?:pagi|siang|sore|malam|subuh)/i.test(processedText);
    processedText = processedText.replace(/(?:jam|pukul)\s+(\d{1,2})(?:[.:](\d{2}))?\s*(pagi|siang|sore|malam)?/gi, (_, h, m, period) => {
      let hours = parseInt(h);
      const mins = m ? parseInt(m) : 0;
      if (period) {
        const p = period.toLowerCase();
        if ((p === 'sore' || p === 'malam') && hours < 12) hours += 12;
        if (p === 'pagi' && hours === 12) hours = 0;
      } else if (hasPeriodHint) {
        if (/sore|malam/i.test(processedText) && hours > 0 && hours < 12) hours += 12;
      }
      return `at ${hours}:${String(mins).padStart(2, '0')} `;
    });

    // Compound date+period: "besok pagi" → "tomorrow at 8:00"
    // Only use default period time if no explicit "jam X" was already resolved above
    const hasExplicitTime = /at \d{1,2}:\d{2}/.test(processedText);
    processedText = processedText.replace(/nanti\s+(pagi|siang|sore|malam|subuh)/gi, (_, period) => {
      if (hasExplicitTime) return 'today';
      return `today at ${ID_TIME_WORDS[period.toLowerCase()]?.hours || 12}:00`;
    });
    processedText = processedText.replace(/besok\s+(pagi|siang|sore|malam|subuh)/gi, (_, period) => {
      if (hasExplicitTime) return 'tomorrow';
      return `tomorrow at ${ID_TIME_WORDS[period.toLowerCase()]?.hours || 12}:00`;
    });
    processedText = processedText.replace(/lusa\s+(pagi|siang|sore|malam|subuh)/gi, (_, period) => {
      if (hasExplicitTime) return 'in 2 days';
      return `in 2 days at ${ID_TIME_WORDS[period.toLowerCase()]?.hours || 12}:00`;
    });

    const idParse = parseIndonesianDateTime(processedText);
    if (idParse) {
      processedText = processedText.replace(new RegExp(idParse.timeWord, 'i'), `${idParse.config.hours}:00`);
    }

    for (const [idWord, enWord] of Object.entries(ID_DATE_WORDS)) {
      processedText = processedText.replace(new RegExp(idWord, 'gi'), enWord);
    }
  }

  const parsed = chrono.parse(processedText, new Date(), { forwardDate: true });

  if (parsed.length > 0) {
    results.datetime = parsed[0].start.date();

    const remainingText = processedText.replace(parsed[0].text, '').trim();

    const prefixPatterns = language === 'id'
      ? /ingatkan saya untuk|ingatkan saya|ingatkan|bikin reminder|pasang alarm|inget(?:in|kan)?(?:\s+saya)?|tolong ingetin|nanti\s+ingetin/i
      : /remind me to|remind me|remember to|don't forget to|set a reminder to|alert me/i;

    results.task = remainingText
      .replace(prefixPatterns, '')
      .replace(/^\s*:?\d{0,2}\s*/, '') // strip leftover ":00" or "00" from time parsing
      .replace(/\s*at\s+\d{1,2}:\d{2}\s*/g, ' ') // strip any remaining "at HH:MM"
      .replace(/\s{2,}/g, ' ')
      .trim() || null;
  } else {
    const timeMatch = processedText.match(/at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
    if (timeMatch) {
      const prefixPatterns = language === 'id'
        ? /ingatkan saya untuk|ingatkan saya|ingatkan|bikin reminder|pasang alarm|inget(?:in|kan)?(?:\s+saya)?/i
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

  if (recPatterns.daily.test(text)) results.recurrence = 'daily';
  else if (recPatterns.weekly.test(text)) results.recurrence = 'weekly';
  else if (recPatterns.monthly.test(text)) results.recurrence = 'monthly';

  return results;
}

// ─── Memory Parsing ───────────────────────────────────────────────────────────

export function parseMemory(text, language = 'en') {
  const results = { type: 'fact', content: text, metadata: {} };

  const preferencePatterns = {
    en: /prefer|like|don't like|dislike|hate|love/i,
    id: /suka|tidak suka|anti|gemar|benci|malas|senang|doyan/i,
  };
  const eventPatterns = {
    en: /meeting|event|appointment/i,
    id: /rapat|pertemuan|acara|jadwal|appointment/i,
  };

  const prefPattern = preferencePatterns[language] || preferencePatterns.en;
  const evtPattern = eventPatterns[language] || eventPatterns.en;

  if (prefPattern.test(text)) results.type = 'preference';
  else if (evtPattern.test(text)) results.type = 'event';

  const datePatterns = [
    /(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{2,4})/i,
    /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{2,4})/i,
    /(\d{4}-\d{2}-\d{2})/,
    /(\d{1,2}\s+\w+\s+\d{4})/i,
    /(\d{1,2}\/\d{1,2}\/\d{2,4})/,
  ];

  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match) { results.metadata.date = match[1]; break; }
  }

  return results;
}

// ─── Response Templates ───────────────────────────────────────────────────────

export function getResponseTemplates(language = 'en') {
  const templates = {
    en: {
      welcome: "Hi! I'm Nemoris, your personal AI memory assistant.\n\nI can help you:\n📝 Remember facts and preferences\n⏰ Set reminders\n💬 Answer questions based on what you've told me\n\nJust chat with me naturally!",
      reminderSet: "✅ Got it! I'll remind you.\n\n📌 {task}\n🕐 {time}\n\nI'll ping you when it's time!",
      reminderRecurrence: "\n🔁 Repeats: {recurrence}",
      memoryStored: "✅ I've remembered that! {summary}",
      memoryStoredDefault: "✅ I've stored that in my memory!",
      error: "I'm sorry, I encountered an error. Please try again.",
      reminderError: "Hmm, I need a bit more detail 🤔\n\nTry something like:\n• Remind me to call mom at 3pm\n• Remind me to study in 30 minutes\n• Don't forget to pay bills tomorrow morning",
      clarification: "Could you clarify? For example: 'Remind me to pay bill at 3pm' or 'Ingatkan saya untuk bayar tagihan jam 3 sore'",
    },
    id: {
      welcome: "Halo! Saya Nemoris, asisten AI memory personal kamu.\n\nSaya bisa membantu kamu:\n📝 Mengingat fakta dan preferensi\n⏰ Mengatur pengingat\n💬 Menjawab pertanyaan berdasarkan yang sudah kamu beritahu\n\nSilakan chat dengan saya secara alami!",
      reminderSet: "✅ Siap, nanti aku ingatkan!\n\n📌 {task}\n🕐 {time}\n\nTenang aja, aku pasti ingetin kamu!",
      reminderRecurrence: "\n🔁 Diulang: {recurrence}",
      memoryStored: "✅ Sudah diingat! {summary}",
      memoryStoredDefault: "✅ Sudah saya simpan!",
      error: "Maaf, terjadi kesalahan. Silakan coba lagi.",
      reminderError: "Hmm, aku butuh info lebih detail 🤔\n\nCoba kayak gini:\n• Ingatkan aku belajar jam 3 sore\n• Ingetin aku bayar tagihan 30 menit lagi\n• Jangan lupa telpon mama besok pagi",
      clarification: "Bisa diperjelas? Contoh: 'Ingatkan saya bayar tagihan jam 3 sore'",
    },
  };

  return templates[language] || templates.en;
}
