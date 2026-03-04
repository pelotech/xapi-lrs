import { HttpError } from './errors.js';

describe('HttpError', () => {
  it('has status, code, and message properties', () => {
    const err = new HttpError(404, 'NOT_FOUND', 'Resource not found');
    expect(err.status).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('Resource not found');
  });

  it('extends Error', () => {
    const err = new HttpError(500, 'INTERNAL', 'Something broke');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('HttpError');
  });

  it('has a proper stack trace', () => {
    const err = new HttpError(400, 'BAD_REQUEST', 'Invalid input');
    expect(err.stack).toBeDefined();
    expect(err.stack).toContain('HttpError');
  });
});
