import pino from 'pino';
import type { AppConfig } from './config.js';

const SENSITIVE_PARAMS = /([?&])(token|key|secret|password|api_key|access_token|refresh_token)=[^&]*/gi;

export function redactUrl(url: string): string {
  return url.replace(SENSITIVE_PARAMS, '$1$2=[REDACTED]');
}

export function createLogger(config: AppConfig): pino.Logger {
  return pino({
    level: config.logLevel,
    redact: ['req.headers.authorization', 'req.headers.cookie'],
    serializers: {
      ...pino.stdSerializers,
      req(req) {
        const serialized = pino.stdSerializers.req(req);
        if (serialized.url) {
          serialized.url = redactUrl(serialized.url);
        }
        return serialized;
      },
    },
  });
}
