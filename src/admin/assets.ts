/**
 * Vendored admin UI assets — served from memory, no CDN dependency.
 * Files are read once at import time and served as string constants.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const HTMX_JS = readFileSync(resolve(here, 'vendor/htmx.min.js'), 'utf8');
export const HTMX_SSE_JS = readFileSync(resolve(here, 'vendor/sse.js'), 'utf8');
export const PICO_CSS = readFileSync(resolve(here, 'vendor/pico.classless.min.css'), 'utf8');
