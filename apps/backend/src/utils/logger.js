import winston from 'winston';
import { SPLAT } from 'triple-beam';

const logLevel = process.env.LOG_LEVEL || 'info';

function stringifyMeta(meta) {
  const seen = new WeakSet();
  return JSON.stringify(meta, function replacer(_key, value) {
    if (value instanceof Error) {
      return { name: value.name, message: value.message, stack: value.stack };
    }
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  });
}

/**
 * Winston puts extra `logger.info(msg, x)` args in SPLAT. Primitives are only there (not merged).
 * Objects and arrays are also merged onto `info`, so stringifying SPLAT would duplicate them.
 */
function formatSplat(splat) {
  if (!splat?.length) return '';
  return splat
    .filter(
      (item) =>
        typeof item === 'string' ||
        typeof item === 'number' ||
        typeof item === 'boolean' ||
        typeof item === 'bigint'
    )
    .map((item) => (typeof item === 'string' ? item : String(item)))
    .join(' ');
}

export const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  // defaultMeta: { service: 'nemoris' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf((info) => {
          const { timestamp, level, message, [SPLAT]: splat } = info;
          const meta = {};
          for (const key of Object.keys(info)) {
            if (key !== 'timestamp' && key !== 'level' && key !== 'message') {
              meta[key] = info[key];
            }
          }
          let metaStr = '';
          if (Object.keys(meta).length) {
            try {
              metaStr = stringifyMeta(meta);
            } catch {
              metaStr = '[unserializable meta]';
            }
          }
          const splatStr = formatSplat(splat);
          const tail = [metaStr, splatStr].filter(Boolean).join(' ');
          return `${timestamp} [${level}]: ${message}${tail ? ` ${tail}` : ''}`;
        })
      ),
    }),
  ],
});
