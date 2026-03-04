import { redactUrl } from './logger.js';

describe('redactUrl', () => {
  it('redacts token parameter', () => {
    expect(redactUrl('/path?token=abc123')).toBe('/path?token=[REDACTED]');
  });

  it('redacts key parameter', () => {
    expect(redactUrl('/path?key=secret-key')).toBe('/path?key=[REDACTED]');
  });

  it('redacts api_key parameter', () => {
    expect(redactUrl('/path?api_key=xyz')).toBe('/path?api_key=[REDACTED]');
  });

  it('redacts access_token and refresh_token', () => {
    expect(redactUrl('/path?access_token=a&refresh_token=b')).toBe(
      '/path?access_token=[REDACTED]&refresh_token=[REDACTED]',
    );
  });

  it('redacts secret and password', () => {
    expect(redactUrl('/path?secret=s&password=p')).toBe(
      '/path?secret=[REDACTED]&password=[REDACTED]',
    );
  });

  it('preserves non-sensitive parameters', () => {
    expect(redactUrl('/path?page=1&token=abc&limit=10')).toBe(
      '/path?page=1&token=[REDACTED]&limit=10',
    );
  });

  it('returns path unchanged when no sensitive params', () => {
    expect(redactUrl('/v1/healthcheck?page=1')).toBe('/v1/healthcheck?page=1');
  });

  it('handles URLs with no query string', () => {
    expect(redactUrl('/v1/healthcheck')).toBe('/v1/healthcheck');
  });
});
