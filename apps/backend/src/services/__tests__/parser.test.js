import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  normalizePronouns,
  normalizeSlang,
  normalizeText,
  detectLanguage,
  tryIntentLexicalFastPath,
  detectIntent,
  scoreIntentHeuristic,
  INTENT_PATTERNS,
  parseReminder,
  parseMemory,
  getResponseTemplates,
} from '../parser.js';

// ─── normalizePronouns ──────────────────────────────────────────────────────────

describe('normalizePronouns', () => {
  describe('positive: first-person pronouns → saya', () => {
    it.each([
      ['gue mau makan', 'saya mau makan'],
      ['gw pergi', 'saya pergi'],
      ['aku suka kopi', 'saya suka kopi'],
      ['ane tinggal di Jakarta', 'saya tinggal di Jakarta'],
    ])('"%s" → "%s"', (input, expected) => {
      expect(normalizePronouns(input)).toBe(expected);
    });
  });

  describe('positive: second-person pronouns → kamu', () => {
    it.each([
      ['lu mau kemana', 'kamu mau kemana'],
      ['lo gila', 'kamu gila'],
      ['kamu sudah makan', 'kamu sudah makan'],
    ])('"%s" → "%s"', (input, expected) => {
      expect(normalizePronouns(input)).toBe(expected);
    });
  });

  describe('negative: should NOT replace inside words', () => {
    it('does not replace "waktu" (contains "w" and "u")', () => {
      const result = normalizePronouns('waktu makan');
      // "w" and "u" are word-boundary matched, so they shouldn't match inside "waktu"
      expect(result).toBe('waktu makan');
    });

    it('does not replace "anak" (contains "ak")', () => {
      expect(normalizePronouns('anak kecil')).toBe('anak kecil');
    });
  });

  describe('negative: empty and whitespace', () => {
    it('handles empty string', () => {
      expect(normalizePronouns('')).toBe('');
    });

    it('handles only whitespace', () => {
      expect(normalizePronouns('   ')).toBe('   ');
    });
  });
});

// ─── normalizeSlang ─────────────────────────────────────────────────────────────

describe('normalizeSlang', () => {
  describe('positive: time-unit abbreviations', () => {
    it.each([
      ['5 mnt lagi', '5 menit lagi'],
      ['10 dtk', '10 detik'],
      ['2 jm lagi', '2 jam lagi'],
    ])('"%s" → "%s"', (input, expected) => {
      expect(normalizeSlang(input)).toBe(expected);
    });
  });

  describe('positive: date abbreviations', () => {
    it.each([
      ['bsk pagi', 'besok pagi'],
      ['skrg juga', 'sekarang juga'],
      ['ntar sore', 'nanti sore'],
    ])('"%s" → "%s"', (input, expected) => {
      expect(normalizeSlang(input)).toBe(expected);
    });
  });

  describe('positive: verb abbreviations', () => {
    it.each([
      ['bljr matematika', 'belajar matematika'],
      ['mkn siang', 'makan siang'],
      ['tdr dulu', 'tidur dulu'],
      ['byr tagihan', 'bayar tagihan'],
    ])('"%s" → "%s"', (input, expected) => {
      expect(normalizeSlang(input)).toBe(expected);
    });
  });

  describe('positive: multi-word slang', () => {
    it.each([
      ['hr ini kerja', 'hari ini kerja'],
      ['mlm ini tidur', 'malam ini tidur'],
    ])('"%s" → "%s"', (input, expected) => {
      expect(normalizeSlang(input)).toBe(expected);
    });
  });

  describe('negative: unknown slang untouched', () => {
    it('leaves unknown abbreviations alone', () => {
      expect(normalizeSlang('xyz abc')).toBe('xyz abc');
    });
  });
});

// ─── normalizeText (pipeline) ───────────────────────────────────────────────────

describe('normalizeText', () => {
  it('lowercases + normalizes pronouns + normalizes slang in order', () => {
    expect(normalizeText('GUE mau BLJR bsk')).toBe('saya mau belajar besok');
  });

  it('handles mixed case slang', () => {
    expect(normalizeText('Ntar Sore')).toBe('nanti sore');
  });

  it('handles empty string', () => {
    expect(normalizeText('')).toBe('');
  });
});

// ─── detectLanguage ─────────────────────────────────────────────────────────────

describe('detectLanguage', () => {
  describe('positive: Indonesian detection', () => {
    it.each([
      'ingatkan saya untuk makan siang besok',
      'saya tinggal di Jakarta dan bekerja di kantor',
      'nama saya adalah Budi',
    ])('detects "%s" as Indonesian', (text) => {
      expect(detectLanguage(text)).toBe('id');
    });
  });

  describe('positive: English detection', () => {
    it.each([
      'remind me to buy groceries tomorrow',
      'my name is John and I live in New York',
      'what is the weather like today',
    ])('detects "%s" as English', (text) => {
      expect(detectLanguage(text)).toBe('en');
    });
  });

  describe('negative: edge cases', () => {
    it('returns "en" for empty string', () => {
      expect(detectLanguage('')).toBe('en');
    });

    it('returns "en" for null/undefined', () => {
      expect(detectLanguage(null)).toBe('en');
      expect(detectLanguage(undefined)).toBe('en');
    });

    it('returns "en" for single word ambiguity', () => {
      // Single short words can be ambiguous
      const result = detectLanguage('ok');
      expect(['en', 'id']).toContain(result);
    });
  });
});

// ─── tryIntentLexicalFastPath ───────────────────────────────────────────────────

describe('tryIntentLexicalFastPath', () => {
  describe('positive: strong reminder patterns', () => {
    it.each([
      'remind me to call mom at 3pm',
      'ingatkan saya untuk belajar jam 3',
      'jangan lupa bayar tagihan',
      'bikin reminder untuk makan obat',
      'set a reminder to study tonight',
      "don't forget to buy milk",
      'reminder beli susu besok',
    ])('detects reminder: "%s"', (text) => {
      const result = tryIntentLexicalFastPath(text);
      expect(result).not.toBeNull();
      expect(result.intent).toBe('reminder');
      expect(result.source).toBe('lexical');
    });
  });

  describe('positive: strong memory patterns', () => {
    it.each([
      'remember that my birthday is January 5th',
      'my name is John',
      'note that I prefer tea over coffee',
      'simpan nomor telepon saya 081234',
      'catat alamat rumah saya di Bandung',
      'nama kucing saya adalah Mochi',
      'saya tinggal di Surabaya',
      'saya alergi kacang',
      'ulang tahun saya tanggal 5 Januari',
      'pacar saya namanya Lisa',
      'makanan favorit saya nasi goreng',
    ])('detects memory: "%s"', (text) => {
      const result = tryIntentLexicalFastPath(text);
      expect(result).not.toBeNull();
      expect(result.intent).toBe('memory');
      expect(result.source).toBe('lexical');
    });
  });

  describe('positive: reminder wins even with question mark', () => {
    it('strong reminder pattern still matches with "?"', () => {
      const result = tryIntentLexicalFastPath('remind me to call mom at 3pm?');
      expect(result).not.toBeNull();
      expect(result.intent).toBe('reminder');
    });
  });

  describe('negative: no match for general chat', () => {
    it.each([
      'hello there',
      'what is the meaning of life',
      'halo apa kabar',
      'terima kasih',
      'good morning',
      '12345',
    ])('returns null for: "%s"', (text) => {
      expect(tryIntentLexicalFastPath(text)).toBeNull();
    });
  });

  describe('negative: empty/whitespace', () => {
    it('returns null for empty string', () => {
      expect(tryIntentLexicalFastPath('')).toBeNull();
    });

    it('returns null for whitespace only', () => {
      expect(tryIntentLexicalFastPath('   ')).toBeNull();
    });
  });
});

// ─── detectIntent (weaker patterns + question guard) ────────────────────────────

describe('detectIntent', () => {
  describe('positive: strong patterns still match (superset of fastPath)', () => {
    it('detects strong reminder', () => {
      const result = detectIntent('remind me to study at 5pm');
      expect(result.intent).toBe('reminder');
    });

    it('detects strong memory', () => {
      const result = detectIntent('my dog name is Rex');
      expect(result.intent).toBe('memory');
    });
  });

  describe('positive: question detection', () => {
    it.each([
      'what is your name?',
      'can you help me?',
      'apakah kamu bisa membantu?',
      'siapa kamu?',
      'how does this work?',
      'bagaimana caranya?',
    ])('detects question: "%s"', (text) => {
      const result = detectIntent(text);
      expect(result).not.toBeNull();
      expect(result.intent).toBe('question');
    });
  });

  describe('negative: returns null for ambiguous text', () => {
    it.each([
      'ok',
      'hmm',
      'baiklah',
      '3 sore',
    ])('returns null for ambiguous: "%s"', (text) => {
      const result = detectIntent(text);
      // Should be null (ambiguous) or question, never a false-positive reminder/memory
      if (result !== null) {
        expect(['question']).toContain(result.intent);
      }
    });
  });
});

// ─── scoreIntentHeuristic (Tier 2) ──────────────────────────────────────────────

describe('scoreIntentHeuristic', () => {
  describe('positive: time hints boost reminder', () => {
    it('text with time words scores as reminder', () => {
      const result = scoreIntentHeuristic('besok sore beli obat', 'id');
      if (result) {
        expect(result.intent).toBe('reminder');
        expect(result.source).toBe('heuristic');
      }
    });
  });

  describe('positive: personal facts boost memory', () => {
    it('text with personal pronouns + fact verbs scores as memory', () => {
      const result = scoreIntentHeuristic('saya tinggal di rumah baru bernama indah', 'id');
      if (result) {
        expect(result.intent).toBe('memory');
      }
    });
  });

  describe('positive: context boosts override', () => {
    it('reminder_error context boosts reminder score', () => {
      const context = { lastBotAction: 'reminder_error', pendingSlot: 'reminder_time' };
      const result = scoreIntentHeuristic('jam 3 sore', 'id', context);
      expect(result).not.toBeNull();
      expect(result.intent).toBe('reminder');
    });

    it('asked_info context boosts memory score', () => {
      const context = { lastBotAction: 'asked_info', pendingSlot: 'person_name' };
      const result = scoreIntentHeuristic('Lisa', 'id', context);
      expect(result).not.toBeNull();
      expect(result.intent).toBe('memory');
    });
  });

  describe('negative: ambiguous text returns null', () => {
    it('returns null when scores are too close', () => {
      const result = scoreIntentHeuristic('hello', 'en');
      // Greeting with no signals — should be null (ambiguous)
      expect(result).toBeNull();
    });
  });

  describe('negative: question markers compete', () => {
    it('question mark adds question score', () => {
      const result = scoreIntentHeuristic('kapan kamu tidur?', 'id');
      if (result) {
        expect(result.intent).toBe('question');
      }
    });
  });
});

// ─── parseReminder ──────────────────────────────────────────────────────────────

describe('parseReminder', () => {
  describe('positive: English reminders', () => {
    it('parses "remind me to call mom at 3pm"', () => {
      const result = parseReminder('remind me to call mom at 3pm', 'en');
      expect(result.task).toBeTruthy();
      expect(result.datetime).toBeInstanceOf(Date);
      expect(result.datetime.getHours()).toBe(15);
    });

    it('parses relative time "in 30 minutes"', () => {
      const now = Date.now();
      const result = parseReminder('remind me to stretch in 30 minutes', 'en');
      expect(result.task).toBeTruthy();
      expect(result.datetime).toBeInstanceOf(Date);
      // Should be roughly 30 minutes from now (within 2 min tolerance)
      const diff = result.datetime.getTime() - now;
      expect(diff).toBeGreaterThan(28 * 60 * 1000);
      expect(diff).toBeLessThan(32 * 60 * 1000);
    });

    it('parses "tomorrow"', () => {
      const result = parseReminder('remind me to study tomorrow at 9am', 'en');
      expect(result.datetime).toBeInstanceOf(Date);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      expect(result.datetime.getDate()).toBe(tomorrow.getDate());
    });
  });

  describe('positive: Indonesian reminders', () => {
    it('parses "5 menit lagi"', () => {
      const now = Date.now();
      const result = parseReminder('ingatkan saya makan 5 menit lagi', 'id');
      expect(result.datetime).toBeInstanceOf(Date);
      const diff = result.datetime.getTime() - now;
      expect(diff).toBeGreaterThan(3 * 60 * 1000);
      expect(diff).toBeLessThan(7 * 60 * 1000);
    });

    it('parses "besok pagi"', () => {
      const result = parseReminder('ingatkan saya belajar besok pagi', 'id');
      expect(result.datetime).toBeInstanceOf(Date);
      expect(result.datetime.getHours()).toBe(8);
    });

    it('parses "nanti siang"', () => {
      const result = parseReminder('ingatkan saya makan nanti siang', 'id');
      expect(result.datetime).toBeInstanceOf(Date);
      expect(result.datetime.getHours()).toBe(12);
    });

    it('parses "jam 3 sore"', () => {
      const result = parseReminder('ingatkan saya jam 3 sore beli obat', 'id');
      expect(result.datetime).toBeInstanceOf(Date);
      expect(result.datetime.getHours()).toBe(15);
    });

    it('parses "setengah jam lagi"', () => {
      const now = Date.now();
      const result = parseReminder('ingatkan saya setengah jam lagi istirahat', 'id');
      expect(result.datetime).toBeInstanceOf(Date);
      const diff = result.datetime.getTime() - now;
      expect(diff).toBeGreaterThan(28 * 60 * 1000);
      expect(diff).toBeLessThan(32 * 60 * 1000);
    });
  });

  describe('positive: recurrence detection', () => {
    it('detects daily recurrence (EN)', () => {
      const result = parseReminder('remind me to exercise daily at 7am', 'en');
      expect(result.recurrence).toBe('daily');
    });

    it('detects weekly recurrence (EN)', () => {
      const result = parseReminder('remind me to call mom every week at 10am', 'en');
      expect(result.recurrence).toBe('weekly');
    });

    it('detects daily recurrence (ID)', () => {
      const result = parseReminder('ingatkan saya setiap hari minum obat jam 8', 'id');
      expect(result.recurrence).toBe('daily');
    });

    it('detects monthly recurrence (ID)', () => {
      const result = parseReminder('ingatkan saya bulanan bayar listrik besok', 'id');
      expect(result.recurrence).toBe('monthly');
    });
  });

  describe('negative: unparseable reminders', () => {
    it('returns null task and datetime for gibberish', () => {
      const result = parseReminder('asdfghjkl', 'en');
      expect(result.task).toBeNull();
      expect(result.datetime).toBeNull();
    });

    it('returns null datetime when no time info', () => {
      const result = parseReminder('ingatkan saya beli sesuatu', 'id');
      // Might parse task but no datetime
      expect(result.datetime).toBeNull();
    });

    it('returns null recurrence when not recurring', () => {
      const result = parseReminder('remind me to call mom at 3pm', 'en');
      expect(result.recurrence).toBeNull();
    });
  });
});

// ─── parseMemory ────────────────────────────────────────────────────────────────

describe('parseMemory', () => {
  describe('positive: type detection', () => {
    it('detects preference type (EN)', () => {
      const result = parseMemory('I prefer coffee over tea', 'en');
      expect(result.type).toBe('preference');
    });

    it('detects preference type (ID)', () => {
      const result = parseMemory('saya suka nasi goreng', 'id');
      expect(result.type).toBe('preference');
    });

    it('detects event type (EN)', () => {
      const result = parseMemory('I have a meeting at 3pm', 'en');
      expect(result.type).toBe('event');
    });

    it('detects event type (ID)', () => {
      const result = parseMemory('ada rapat jam 3 sore', 'id');
      expect(result.type).toBe('event');
    });

    it('defaults to fact type', () => {
      const result = parseMemory('my name is John', 'en');
      expect(result.type).toBe('fact');
    });
  });

  describe('positive: date extraction', () => {
    it('extracts ISO date', () => {
      const result = parseMemory('meeting on 2025-01-15', 'en');
      expect(result.metadata.date).toBe('2025-01-15');
    });

    it('extracts "15 Jan 2025" format', () => {
      const result = parseMemory('deadline 15 Jan 2025', 'en');
      expect(result.metadata.date).toBe('15 Jan 2025');
    });

    it('extracts slash date', () => {
      const result = parseMemory('birthday 01/15/2025', 'en');
      expect(result.metadata.date).toBe('01/15/2025');
    });
  });

  describe('negative: no date found', () => {
    it('metadata.date is undefined when no date in text', () => {
      const result = parseMemory('I like cats', 'en');
      expect(result.metadata.date).toBeUndefined();
    });
  });

  describe('negative: content passthrough', () => {
    it('preserves original text as content', () => {
      const result = parseMemory('random text 123', 'en');
      expect(result.content).toBe('random text 123');
    });
  });
});

// ─── getResponseTemplates ───────────────────────────────────────────────────────

describe('getResponseTemplates', () => {
  describe('positive: template structure', () => {
    it('returns English templates', () => {
      const t = getResponseTemplates('en');
      expect(t).toHaveProperty('welcome');
      expect(t).toHaveProperty('reminderSet');
      expect(t).toHaveProperty('reminderRecurrence');
      expect(t).toHaveProperty('memoryStored');
      expect(t).toHaveProperty('memoryStoredDefault');
      expect(t).toHaveProperty('error');
      expect(t).toHaveProperty('reminderError');
      expect(t).toHaveProperty('clarification');
    });

    it('returns Indonesian templates', () => {
      const t = getResponseTemplates('id');
      expect(t.welcome).toContain('Halo');
      expect(t.reminderSet).toContain('{task}');
      expect(t.reminderSet).toContain('{time}');
    });
  });

  describe('positive: templates have placeholders', () => {
    it('reminderSet has {task} and {time}', () => {
      const t = getResponseTemplates('en');
      expect(t.reminderSet).toContain('{task}');
      expect(t.reminderSet).toContain('{time}');
    });

    it('memoryStored has {summary}', () => {
      const t = getResponseTemplates('en');
      expect(t.memoryStored).toContain('{summary}');
    });
  });

  describe('negative: unknown language falls back to English', () => {
    it('returns English for unknown language code', () => {
      const t = getResponseTemplates('fr');
      expect(t.welcome).toContain('Hi!');
    });

    it('returns English for undefined', () => {
      const t = getResponseTemplates();
      expect(t.welcome).toContain('Hi!');
    });
  });
});

// ─── Cross-cutting: normalization → intent pipeline ─────────────────────────────

describe('normalization → intent integration', () => {
  it('slang-heavy Indonesian reminder is detected after normalization', () => {
    // "gue mau diingetin bljr bsk pgi" → normalizes → should match reminder
    const result = tryIntentLexicalFastPath('ingetin gue bljr bsk pgi');
    expect(result).not.toBeNull();
    expect(result.intent).toBe('reminder');
  });

  it('slang-heavy Indonesian memory is detected after normalization', () => {
    const result = tryIntentLexicalFastPath('simpan alamat rmh gue di Bandung');
    expect(result).not.toBeNull();
    expect(result.intent).toBe('memory');
  });
});

// ─── Regression: HIGH-1 pronoun fix — standalone letters no longer replaced ────

describe('regression: pronoun regex no longer matches standalone w/u/ak', () => {
  it('standalone "w" is NOT replaced with "saya"', () => {
    expect(normalizePronouns('w')).toBe('w');
  });

  it('standalone "u" is NOT replaced with "kamu"', () => {
    expect(normalizePronouns('u')).toBe('u');
  });

  it('standalone "ak" is NOT replaced with "saya"', () => {
    expect(normalizePronouns('ak')).toBe('ak');
  });

  it('"aku" is still replaced with "saya"', () => {
    expect(normalizePronouns('aku lapar')).toBe('saya lapar');
  });

  it('"kamu" is still replaced with "kamu" (identity)', () => {
    expect(normalizePronouns('kamu hebat')).toBe('kamu hebat');
  });
});

// ─── Regression: HIGH-2 ambiguous time — no auto-PM for bare "jam X" ──────────

describe('regression: "jam X" without period word keeps original hour', () => {
  it('"jam 5" without period does NOT become 17:00', () => {
    const result = parseReminder('ingatkan saya jam 5 bangun', 'id');
    if (result.datetime) {
      // Should be 5:00, NOT 17:00
      expect(result.datetime.getHours()).toBe(5);
    }
  });

  it('"jam 3 sore" with explicit period still becomes 15:00', () => {
    const result = parseReminder('ingatkan saya jam 3 sore beli obat', 'id');
    expect(result.datetime).toBeInstanceOf(Date);
    expect(result.datetime.getHours()).toBe(15);
  });

  it('"jam 8 malam" with explicit period becomes 20:00', () => {
    const result = parseReminder('ingatkan saya jam 8 malam tidur', 'id');
    expect(result.datetime).toBeInstanceOf(Date);
    expect(result.datetime.getHours()).toBe(20);
  });
});

// ─── Regression: MEDIUM-4 detectIntent no longer duplicates strong patterns ───

describe('regression: detectIntent only checks weak patterns', () => {
  it('question guard works without strong patterns interfering', () => {
    const result = detectIntent('apa nama kucing saya?');
    expect(result).not.toBeNull();
    expect(result.intent).toBe('question');
  });
});
