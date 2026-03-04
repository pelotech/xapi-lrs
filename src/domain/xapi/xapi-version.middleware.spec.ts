import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { xapiVersionMiddleware } from './xapi-version.middleware.js';

function createMocks(versionHeader?: string) {
  const req = {
    headers: versionHeader !== undefined
      ? { 'x-experience-api-version': versionHeader }
      : {},
  } as unknown as Request;

  const resHeaders = new Map<string, string>();
  const res = {
    setHeader: vi.fn((name: string, value: string) => resHeaders.set(name, value)),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as unknown as Response;

  const next = vi.fn() as unknown as NextFunction;

  return { req, res, next, resHeaders };
}

describe('xapiVersionMiddleware', () => {
  it('passes through and sets response header for version 1.0.3', () => {
    const { req, res, next } = createMocks('1.0.3');
    xapiVersionMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('X-Experience-API-Version', '1.0.3');
    expect(res.status).not.toHaveBeenCalled();
  });

  it('accepts version 1.0.0', () => {
    const { req, res, next } = createMocks('1.0.0');
    xapiVersionMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('accepts version 1.0 (shorthand per spec)', () => {
    const { req, res, next } = createMocks('1.0');
    xapiVersionMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('accepts version 1.0.2', () => {
    const { req, res, next } = createMocks('1.0.2');
    xapiVersionMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('rejects missing version header with 400', () => {
    const { req, res, next } = createMocks();
    xapiVersionMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'INVALID_XAPI_VERSION' }),
      }),
    );
  });

  it('rejects version 1.1.0 with 400', () => {
    const { req, res, next } = createMocks('1.1.0');
    xapiVersionMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects version 2.0.0 with 400', () => {
    const { req, res, next } = createMocks('2.0.0');
    xapiVersionMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects version 0.9 with 400', () => {
    const { req, res, next } = createMocks('0.9');
    xapiVersionMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects empty string with 400', () => {
    const { req, res, next } = createMocks('');
    xapiVersionMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('always sets response version header even on rejection', () => {
    const { req, res, next } = createMocks('bad');
    xapiVersionMiddleware(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-Experience-API-Version', '1.0.3');
  });
});
