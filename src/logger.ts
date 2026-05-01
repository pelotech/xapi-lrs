/**
 * Pino logger for the LRS service.
 */

import { pino } from 'pino';
import type { LrsConfig } from './config.ts';

export type Logger = pino.Logger;

export function createLogger(config: LrsConfig): Logger {
  return pino({ level: config.logLevel });
}
