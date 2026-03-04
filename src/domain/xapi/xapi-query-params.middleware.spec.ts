import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { xapiQueryParamsMiddleware } from './xapi-query-params.middleware.js';

function createMocks(method: string, path: string, query: Record<string, string> = {}) {
  const req = { method, path, baseUrl: '', query } as unknown as Request;

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    setHeader: vi.fn(),
  } as unknown as Response;

  const next = vi.fn() as unknown as NextFunction;

  return { req, res, next };
}

describe('xapiQueryParamsMiddleware', () => {
  // ---- passes valid requests through ----

  it('passes GET /xapi/statements with known params', () => {
    const { req, res, next } = createMocks('GET', '/xapi/statements', {
      agent: '{"mbox":"mailto:a@b.com"}',
      verb: 'http://example.com/v',
      limit: '10',
    });
    xapiQueryParamsMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('passes GET /xapi/statements with no params', () => {
    const { req, res, next } = createMocks('GET', '/xapi/statements');
    xapiQueryParamsMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('passes GET /xapi/about with no params', () => {
    const { req, res, next } = createMocks('GET', '/xapi/about');
    xapiQueryParamsMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('passes PUT /xapi/statements with statementId', () => {
    const { req, res, next } = createMocks('PUT', '/xapi/statements', {
      statementId: 'abc',
    });
    xapiQueryParamsMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('passes GET /xapi/activities/state with valid params', () => {
    const { req, res, next } = createMocks('GET', '/xapi/activities/state', {
      activityId: 'http://example.com/a',
      agent: '{}',
      stateId: 's1',
    });
    xapiQueryParamsMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  // ---- rejects unknown params ----

  it('rejects GET /xapi/statements with unknown param', () => {
    const { req, res, next } = createMocks('GET', '/xapi/statements', {
      verb: 'http://example.com/v',
      foo: 'bar',
    });
    xapiQueryParamsMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'UNKNOWN_QUERY_PARAMS',
          message: expect.stringContaining('foo'),
        }),
      }),
    );
  });

  it('rejects GET /xapi/about with any param', () => {
    const { req, res, next } = createMocks('GET', '/xapi/about', { extra: '1' });
    xapiQueryParamsMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects POST /xapi/statements with unknown param', () => {
    const { req, res, next } = createMocks('POST', '/xapi/statements', {
      unknown: 'x',
    });
    xapiQueryParamsMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects PUT /xapi/activities/state with unknown param', () => {
    const { req, res, next } = createMocks('PUT', '/xapi/activities/state', {
      activityId: 'http://example.com/a',
      agent: '{}',
      stateId: 's1',
      badParam: 'yes',
    });
    xapiQueryParamsMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    const errorBody = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { error: { message: string } };
    expect(errorBody.error.message).toContain('badParam');
  });

  it('lists all unknown params in error message', () => {
    const { req, res, next } = createMocks('GET', '/xapi/agents', {
      agent: '{}',
      foo: '1',
      bar: '2',
    });
    xapiQueryParamsMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const errorBody = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { error: { message: string } };
    expect(errorBody.error.message).toContain('foo');
    expect(errorBody.error.message).toContain('bar');
  });

  // ---- HEAD normalised to GET ----

  it('rejects HEAD /xapi/statements with unknown param', () => {
    const { req, res, next } = createMocks('HEAD', '/xapi/statements', { foo: 'bar' });
    xapiQueryParamsMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    const errorBody = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { error: { message: string } };
    expect(errorBody.error.message).toContain('foo');
  });

  it('passes HEAD /xapi/statements with known params', () => {
    const { req, res, next } = createMocks('HEAD', '/xapi/statements', { verb: 'http://example.com/v' });
    xapiQueryParamsMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects HEAD /xapi/about with any param', () => {
    const { req, res, next } = createMocks('HEAD', '/xapi/about', { extra: '1' });
    xapiQueryParamsMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // ---- non-xAPI routes pass through ----

  it('passes through for non-xAPI routes', () => {
    const { req, res, next } = createMocks('GET', '/healthz', { any: 'thing' });
    xapiQueryParamsMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('passes through for unknown xAPI sub-paths', () => {
    const { req, res, next } = createMocks('GET', '/xapi/nonexistent', { x: '1' });
    xapiQueryParamsMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
