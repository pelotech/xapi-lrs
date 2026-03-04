import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { xapiAlternateSyntaxMiddleware } from './xapi-alternate-syntax.middleware.js';

function createMocks(
  method: string,
  urlQuery: Record<string, string> = {},
  body?: Record<string, string>,
  headers: Record<string, string> = {},
) {
  const qs = new URLSearchParams(urlQuery).toString();
  const url = qs ? `/xapi/test?${qs}` : '/xapi/test';

  const mock = {
    method,
    url,
    get query() {
      const u = new URL(mock.url, 'http://localhost');
      return Object.fromEntries(u.searchParams.entries());
    },
    body,
    headers: { ...headers },
  };
  const req = mock as unknown as Request;

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as unknown as Response;

  const next = vi.fn() as unknown as NextFunction;

  return { req, res, next };
}

describe('xapiAlternateSyntaxMiddleware', () => {
  // ---- passthrough for normal requests ----

  it('passes through GET requests untouched', () => {
    const { req, res, next } = createMocks('GET', { agent: '{}' });
    xapiAlternateSyntaxMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.method).toBe('GET');
  });

  it('passes through POST without method query param', () => {
    const { req, res, next } = createMocks('POST', {}, { content: '{}' });
    xapiAlternateSyntaxMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.method).toBe('POST');
  });

  it('passes through PUT requests untouched', () => {
    const { req, res, next } = createMocks('PUT', { statementId: 'abc' });
    xapiAlternateSyntaxMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.method).toBe('PUT');
  });

  // ---- method rewriting ----

  it('rewrites POST ?method=PUT to PUT', () => {
    const { req, res, next } = createMocks(
      'POST',
      { method: 'PUT' },
      { statementId: 'abc', 'Content-Type': 'application/json', content: '{"id":"abc"}' },
    );
    xapiAlternateSyntaxMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.method).toBe('PUT');
  });

  it('rewrites POST ?method=GET to GET', () => {
    const { req, res, next } = createMocks(
      'POST',
      { method: 'GET' },
      { agent: '{"mbox":"mailto:a@b.com"}', verb: 'http://example.com/v' },
    );
    xapiAlternateSyntaxMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.method).toBe('GET');
  });

  it('rewrites POST ?method=DELETE to DELETE', () => {
    const { req, res, next } = createMocks(
      'POST',
      { method: 'DELETE' },
      { activityId: 'http://example.com/a', agent: '{}', stateId: 's1' },
    );
    xapiAlternateSyntaxMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.method).toBe('DELETE');
  });

  it('treats method value case-insensitively', () => {
    const { req, res, next } = createMocks('POST', { method: 'put' }, { statementId: 'abc' });
    xapiAlternateSyntaxMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.method).toBe('PUT');
  });

  it('rejects invalid method value', () => {
    const { req, res, next } = createMocks('POST', { method: 'PATCH' }, {});
    xapiAlternateSyntaxMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'BAD_REQUEST' }),
      }),
    );
  });

  // ---- header promotion ----

  it('promotes Authorization form field to header', () => {
    const { req, res, next } = createMocks(
      'POST',
      { method: 'GET' },
      { Authorization: 'Basic dGVzdDp0ZXN0', agent: '{}' },
    );
    xapiAlternateSyntaxMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.headers['authorization']).toBe('Basic dGVzdDp0ZXN0');
  });

  it('promotes X-Experience-API-Version form field to header', () => {
    const { req, res, next } = createMocks(
      'POST',
      { method: 'GET' },
      { 'X-Experience-API-Version': '1.0.3' },
    );
    xapiAlternateSyntaxMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.headers['x-experience-api-version']).toBe('1.0.3');
  });

  it('promotes If-Match and If-None-Match form fields to headers', () => {
    const { req, res, next } = createMocks(
      'POST',
      { method: 'PUT' },
      {
        'If-Match': '"etag-123"',
        'If-None-Match': '*',
        'Content-Type': 'application/octet-stream',
        activityId: 'http://example.com/a',
        agent: '{}',
        stateId: 's1',
        content: 'hello',
      },
    );
    xapiAlternateSyntaxMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.headers['if-match']).toBe('"etag-123"');
    expect(req.headers['if-none-match']).toBe('*');
  });

  // ---- form fields → query params ----

  it('moves non-header, non-content form fields to req.query via URL rewrite', () => {
    const { req, res, next } = createMocks(
      'POST',
      { method: 'PUT' },
      {
        statementId: 'c70c2b85-c294-464f-baca-cebd4fb9b348',
        'Content-Type': 'application/json',
        content: '{"id":"c70c2b85-c294-464f-baca-cebd4fb9b348"}',
      },
    );
    xapiAlternateSyntaxMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.query['statementId']).toBe('c70c2b85-c294-464f-baca-cebd4fb9b348');
    expect(req.query['method']).toBeUndefined();
    expect(req.query['content']).toBeUndefined();
    expect(req.query['Content-Type']).toBeUndefined();
  });

  it('does not include method in forwarded query params', () => {
    const { req, res, next } = createMocks(
      'POST',
      { method: 'GET' },
      { agent: '{}', verb: 'http://example.com/v' },
    );
    xapiAlternateSyntaxMiddleware(req, res, next);

    expect(req.query['agent']).toBe('{}');
    expect(req.query['verb']).toBe('http://example.com/v');
    expect(req.query['method']).toBeUndefined();
  });

  // ---- content handling ----

  it('parses JSON content when Content-Type is application/json', () => {
    const stmt = { id: 'abc', actor: {}, verb: {}, object: {} };
    const { req, res, next } = createMocks(
      'POST',
      { method: 'PUT' },
      {
        'Content-Type': 'application/json',
        statementId: 'abc',
        content: JSON.stringify(stmt),
      },
    );
    xapiAlternateSyntaxMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.body).toEqual(stmt);
  });

  it('rejects invalid JSON in content when Content-Type is application/json', () => {
    const { req, res, next } = createMocks(
      'POST',
      { method: 'PUT' },
      { 'Content-Type': 'application/json', content: 'not-json{' },
    );
    xapiAlternateSyntaxMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('converts content to Buffer for non-JSON content types', () => {
    const { req, res, next } = createMocks(
      'POST',
      { method: 'PUT' },
      {
        'Content-Type': 'application/octet-stream',
        activityId: 'http://example.com/a',
        agent: '{}',
        stateId: 's1',
        content: 'binary-ish content',
      },
    );
    xapiAlternateSyntaxMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(Buffer.isBuffer(req.body)).toBe(true);
    expect((req.body as Buffer).toString('utf-8')).toBe('binary-ish content');
  });

  it('sets body to undefined when no content field', () => {
    const { req, res, next } = createMocks(
      'POST',
      { method: 'GET' },
      { agent: '{}' },
    );
    xapiAlternateSyntaxMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.body).toBeUndefined();
  });

  it('handles POST ?method=GET with no body', () => {
    const { req, res, next } = createMocks('POST', { method: 'GET' });
    xapiAlternateSyntaxMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.method).toBe('GET');
  });

  // ---- Appendix C full example ----

  it('handles the full Appendix C PUT statement example', () => {
    const stmtJson = '{"id":"c70c2b85-c294-464f-baca-cebd4fb9b348","timestamp":"2014-12-29T12:09:37.468Z","actor":{"objectType":"Agent","mbox":"mailto:example@example.com","name":"Test User"},"verb":{"id":"http://adlnet.gov/expapi/verbs/experienced","display":{"en-US":"experienced"}},"object":{"id":"http://example.com/xAPI/activities/myactivity","objectType":"Activity"}}';

    const { req, res, next } = createMocks(
      'POST',
      { method: 'PUT' },
      {
        statementId: 'c70c2b85-c294-464f-baca-cebd4fb9b348',
        Authorization: 'Basic VGVzdFVzZXI6cGFzc3dvcmQ=',
        'X-Experience-API-Version': '1.0.3',
        'Content-Type': 'application/json',
        'Content-Length': '351',
        content: stmtJson,
      },
    );
    xapiAlternateSyntaxMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.method).toBe('PUT');
    expect(req.headers['authorization']).toBe('Basic VGVzdFVzZXI6cGFzc3dvcmQ=');
    expect(req.headers['x-experience-api-version']).toBe('1.0.3');
    expect(req.headers['content-type']).toBe('application/json');
    expect(req.headers['content-length']).toBe('351');
    expect(req.query['statementId']).toBe('c70c2b85-c294-464f-baca-cebd4fb9b348');
    expect(req.query['method']).toBeUndefined();
    expect(req.body).toEqual(JSON.parse(stmtJson));
  });
});
