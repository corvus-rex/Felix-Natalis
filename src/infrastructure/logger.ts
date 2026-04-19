import winston from 'winston';

const { combine, timestamp, colorize, printf } = winston.format;

const format = printf(({ level, message, timestamp, ...meta }) => {
  const metaString = Object.keys(meta).length
    ? `\n${JSON.stringify(meta, null, 2)}`
    : '';
  return `[${timestamp}] ${level}: ${message}${metaString}`;
});

export const logger = winston.createLogger({
  level: 'info',
  format: combine(
    colorize(),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format
  ),
  transports: [new winston.transports.Console()]
});