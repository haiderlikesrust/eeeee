/**
 * Structured logging with Pino. JSON in production for aggregation (e.g. ELK, Datadog).
 * Use LOG_LEVEL=debug|info|warn|error; default "info". In dev, pino-pretty for readable logs.
 */
import pino from 'pino';

const level = process.env.LOG_LEVEL || 'info';
const isDev = process.env.NODE_ENV !== 'production';

const logger = pino({
  level,
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard' },
    },
  }),
  base: { service: 'stoat-api' },
});

export default logger;
