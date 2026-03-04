import { describe, expect, it } from 'vitest';
import { checkScope, hasDefineScope } from './xapi-scopes.js';

// ---------------------------------------------------------------------------
// checkScope
// ---------------------------------------------------------------------------

describe('checkScope', () => {
  // ---- `all` scope ----

  describe('scope: all', () => {
    const scopes = ['all'];

    it('allows GET /xapi/statements', () => {
      expect(checkScope(scopes, 'GET', '/xapi/statements')).toEqual({ allowed: true, readMineOnly: false });
    });

    it('allows PUT /xapi/statements', () => {
      expect(checkScope(scopes, 'PUT', '/xapi/statements')).toEqual({ allowed: true, readMineOnly: false });
    });

    it('allows POST /xapi/statements', () => {
      expect(checkScope(scopes, 'POST', '/xapi/statements')).toEqual({ allowed: true, readMineOnly: false });
    });

    it('allows DELETE /xapi/activities/state', () => {
      expect(checkScope(scopes, 'DELETE', '/xapi/activities/state')).toEqual({ allowed: true, readMineOnly: false });
    });

    it('allows GET /xapi/activities', () => {
      expect(checkScope(scopes, 'GET', '/xapi/activities')).toEqual({ allowed: true, readMineOnly: false });
    });

    it('allows GET /xapi/agents', () => {
      expect(checkScope(scopes, 'GET', '/xapi/agents')).toEqual({ allowed: true, readMineOnly: false });
    });
  });

  // ---- `all/read` scope ----

  describe('scope: all/read', () => {
    const scopes = ['all/read'];

    it('allows GET /xapi/statements', () => {
      expect(checkScope(scopes, 'GET', '/xapi/statements')).toEqual({ allowed: true, readMineOnly: false });
    });

    it('allows HEAD /xapi/statements (HEAD treated as GET)', () => {
      expect(checkScope(scopes, 'HEAD', '/xapi/statements')).toEqual({ allowed: true, readMineOnly: false });
    });

    it('allows GET /xapi/activities/state', () => {
      expect(checkScope(scopes, 'GET', '/xapi/activities/state')).toEqual({ allowed: true, readMineOnly: false });
    });

    it('allows GET /xapi/activities/profile', () => {
      expect(checkScope(scopes, 'GET', '/xapi/activities/profile')).toEqual({ allowed: true, readMineOnly: false });
    });

    it('allows GET /xapi/agents/profile', () => {
      expect(checkScope(scopes, 'GET', '/xapi/agents/profile')).toEqual({ allowed: true, readMineOnly: false });
    });

    it('rejects PUT /xapi/statements', () => {
      expect(checkScope(scopes, 'PUT', '/xapi/statements')).toEqual({ allowed: false, readMineOnly: false });
    });

    it('rejects POST /xapi/statements', () => {
      expect(checkScope(scopes, 'POST', '/xapi/statements')).toEqual({ allowed: false, readMineOnly: false });
    });

    it('rejects DELETE /xapi/activities/state', () => {
      expect(checkScope(scopes, 'DELETE', '/xapi/activities/state')).toEqual({ allowed: false, readMineOnly: false });
    });
  });

  // ---- `statements/write` scope ----

  describe('scope: statements/write', () => {
    const scopes = ['statements/write'];

    it('allows PUT /xapi/statements', () => {
      expect(checkScope(scopes, 'PUT', '/xapi/statements')).toEqual({ allowed: true, readMineOnly: false });
    });

    it('allows POST /xapi/statements', () => {
      expect(checkScope(scopes, 'POST', '/xapi/statements')).toEqual({ allowed: true, readMineOnly: false });
    });

    it('rejects GET /xapi/statements', () => {
      expect(checkScope(scopes, 'GET', '/xapi/statements')).toEqual({ allowed: false, readMineOnly: false });
    });

    it('rejects GET /xapi/activities/state', () => {
      expect(checkScope(scopes, 'GET', '/xapi/activities/state')).toEqual({ allowed: false, readMineOnly: false });
    });
  });

  // ---- `statements/read` scope ----

  describe('scope: statements/read', () => {
    const scopes = ['statements/read'];

    it('allows GET /xapi/statements', () => {
      expect(checkScope(scopes, 'GET', '/xapi/statements')).toEqual({ allowed: true, readMineOnly: false });
    });

    it('allows HEAD /xapi/statements', () => {
      expect(checkScope(scopes, 'HEAD', '/xapi/statements')).toEqual({ allowed: true, readMineOnly: false });
    });

    it('rejects PUT /xapi/statements', () => {
      expect(checkScope(scopes, 'PUT', '/xapi/statements')).toEqual({ allowed: false, readMineOnly: false });
    });

    it('rejects GET /xapi/activities/state (wrong resource)', () => {
      expect(checkScope(scopes, 'GET', '/xapi/activities/state')).toEqual({ allowed: false, readMineOnly: false });
    });
  });

  // ---- `statements/read/mine` scope ----

  describe('scope: statements/read/mine', () => {
    const scopes = ['statements/read/mine'];

    it('allows GET /xapi/statements with readMineOnly=true', () => {
      expect(checkScope(scopes, 'GET', '/xapi/statements')).toEqual({ allowed: true, readMineOnly: true });
    });

    it('allows HEAD /xapi/statements with readMineOnly=true', () => {
      expect(checkScope(scopes, 'HEAD', '/xapi/statements')).toEqual({ allowed: true, readMineOnly: true });
    });

    it('rejects PUT /xapi/statements', () => {
      expect(checkScope(scopes, 'PUT', '/xapi/statements')).toEqual({ allowed: false, readMineOnly: false });
    });
  });

  // ---- `statements/read` + `statements/read/mine` — broader scope wins ----

  describe('scope: statements/read + statements/read/mine', () => {
    const scopes = ['statements/read', 'statements/read/mine'];

    it('allows GET /xapi/statements with readMineOnly=false (broader scope wins)', () => {
      expect(checkScope(scopes, 'GET', '/xapi/statements')).toEqual({ allowed: true, readMineOnly: false });
    });
  });

  // ---- `state` scope ----

  describe('scope: state', () => {
    const scopes = ['state'];

    it('allows GET /xapi/activities/state', () => {
      expect(checkScope(scopes, 'GET', '/xapi/activities/state')).toEqual({ allowed: true, readMineOnly: false });
    });

    it('allows PUT /xapi/activities/state', () => {
      expect(checkScope(scopes, 'PUT', '/xapi/activities/state')).toEqual({ allowed: true, readMineOnly: false });
    });

    it('allows POST /xapi/activities/state', () => {
      expect(checkScope(scopes, 'POST', '/xapi/activities/state')).toEqual({ allowed: true, readMineOnly: false });
    });

    it('allows DELETE /xapi/activities/state', () => {
      expect(checkScope(scopes, 'DELETE', '/xapi/activities/state')).toEqual({ allowed: true, readMineOnly: false });
    });

    it('rejects GET /xapi/statements', () => {
      expect(checkScope(scopes, 'GET', '/xapi/statements')).toEqual({ allowed: false, readMineOnly: false });
    });

    it('rejects GET /xapi/activities/profile', () => {
      expect(checkScope(scopes, 'GET', '/xapi/activities/profile')).toEqual({ allowed: false, readMineOnly: false });
    });
  });

  // ---- `define` scope ----

  describe('scope: define', () => {
    const scopes = ['define'];

    it('allows GET /xapi/activities/profile', () => {
      expect(checkScope(scopes, 'GET', '/xapi/activities/profile')).toEqual({ allowed: true, readMineOnly: false });
    });

    it('allows PUT /xapi/activities/profile', () => {
      expect(checkScope(scopes, 'PUT', '/xapi/activities/profile')).toEqual({ allowed: true, readMineOnly: false });
    });

    it('allows POST /xapi/activities/profile', () => {
      expect(checkScope(scopes, 'POST', '/xapi/activities/profile')).toEqual({ allowed: true, readMineOnly: false });
    });

    it('allows DELETE /xapi/activities/profile', () => {
      expect(checkScope(scopes, 'DELETE', '/xapi/activities/profile')).toEqual({ allowed: true, readMineOnly: false });
    });

    it('allows GET /xapi/activities', () => {
      expect(checkScope(scopes, 'GET', '/xapi/activities')).toEqual({ allowed: true, readMineOnly: false });
    });

    it('rejects GET /xapi/statements', () => {
      expect(checkScope(scopes, 'GET', '/xapi/statements')).toEqual({ allowed: false, readMineOnly: false });
    });

    it('rejects GET /xapi/agents', () => {
      expect(checkScope(scopes, 'GET', '/xapi/agents')).toEqual({ allowed: false, readMineOnly: false });
    });
  });

  // ---- `profile` scope ----

  describe('scope: profile', () => {
    const scopes = ['profile'];

    it('allows GET /xapi/agents/profile', () => {
      expect(checkScope(scopes, 'GET', '/xapi/agents/profile')).toEqual({ allowed: true, readMineOnly: false });
    });

    it('allows PUT /xapi/agents/profile', () => {
      expect(checkScope(scopes, 'PUT', '/xapi/agents/profile')).toEqual({ allowed: true, readMineOnly: false });
    });

    it('allows POST /xapi/agents/profile', () => {
      expect(checkScope(scopes, 'POST', '/xapi/agents/profile')).toEqual({ allowed: true, readMineOnly: false });
    });

    it('allows DELETE /xapi/agents/profile', () => {
      expect(checkScope(scopes, 'DELETE', '/xapi/agents/profile')).toEqual({ allowed: true, readMineOnly: false });
    });

    it('allows GET /xapi/agents', () => {
      expect(checkScope(scopes, 'GET', '/xapi/agents')).toEqual({ allowed: true, readMineOnly: false });
    });

    it('rejects GET /xapi/statements', () => {
      expect(checkScope(scopes, 'GET', '/xapi/statements')).toEqual({ allowed: false, readMineOnly: false });
    });

    it('rejects GET /xapi/activities', () => {
      expect(checkScope(scopes, 'GET', '/xapi/activities')).toEqual({ allowed: false, readMineOnly: false });
    });
  });

  // ---- HEAD treated as GET ----

  describe('HEAD treated as GET', () => {
    it('HEAD /xapi/activities/state allowed by state scope', () => {
      expect(checkScope(['state'], 'HEAD', '/xapi/activities/state')).toEqual({ allowed: true, readMineOnly: false });
    });

    it('HEAD /xapi/activities/profile allowed by define scope', () => {
      expect(checkScope(['define'], 'HEAD', '/xapi/activities/profile')).toEqual({ allowed: true, readMineOnly: false });
    });

    it('HEAD /xapi/agents/profile allowed by profile scope', () => {
      expect(checkScope(['profile'], 'HEAD', '/xapi/agents/profile')).toEqual({ allowed: true, readMineOnly: false });
    });
  });

  // ---- Unknown / passthrough paths ----

  describe('unknown paths are passthrough', () => {
    it('allows GET /xapi/about (no scope required)', () => {
      expect(checkScope([], 'GET', '/xapi/about')).toEqual({ allowed: true, readMineOnly: false });
    });

    it('allows GET /healthz (non-xAPI path)', () => {
      expect(checkScope([], 'GET', '/healthz')).toEqual({ allowed: true, readMineOnly: false });
    });
  });

  // ---- Empty scopes array ----

  describe('empty scopes array', () => {
    const scopes: string[] = [];

    it('rejects GET /xapi/statements', () => {
      expect(checkScope(scopes, 'GET', '/xapi/statements')).toEqual({ allowed: false, readMineOnly: false });
    });

    it('rejects PUT /xapi/statements', () => {
      expect(checkScope(scopes, 'PUT', '/xapi/statements')).toEqual({ allowed: false, readMineOnly: false });
    });

    it('rejects GET /xapi/activities/state', () => {
      expect(checkScope(scopes, 'GET', '/xapi/activities/state')).toEqual({ allowed: false, readMineOnly: false });
    });

    it('rejects GET /xapi/activities/profile', () => {
      expect(checkScope(scopes, 'GET', '/xapi/activities/profile')).toEqual({ allowed: false, readMineOnly: false });
    });

    it('rejects GET /xapi/agents/profile', () => {
      expect(checkScope(scopes, 'GET', '/xapi/agents/profile')).toEqual({ allowed: false, readMineOnly: false });
    });

    it('allows unknown paths (passthrough)', () => {
      expect(checkScope(scopes, 'GET', '/xapi/about')).toEqual({ allowed: true, readMineOnly: false });
    });
  });

  // ---- Multiple scopes combined ----

  describe('multiple scopes combined', () => {
    it('statements/write + state allows both write and state operations', () => {
      const scopes = ['statements/write', 'state'];
      expect(checkScope(scopes, 'POST', '/xapi/statements')).toEqual({ allowed: true, readMineOnly: false });
      expect(checkScope(scopes, 'GET', '/xapi/activities/state')).toEqual({ allowed: true, readMineOnly: false });
      expect(checkScope(scopes, 'GET', '/xapi/statements')).toEqual({ allowed: false, readMineOnly: false });
    });

    it('statements/read + define allows reading statements and activity profiles', () => {
      const scopes = ['statements/read', 'define'];
      expect(checkScope(scopes, 'GET', '/xapi/statements')).toEqual({ allowed: true, readMineOnly: false });
      expect(checkScope(scopes, 'GET', '/xapi/activities/profile')).toEqual({ allowed: true, readMineOnly: false });
      expect(checkScope(scopes, 'PUT', '/xapi/statements')).toEqual({ allowed: false, readMineOnly: false });
    });
  });
});

// ---------------------------------------------------------------------------
// hasDefineScope
// ---------------------------------------------------------------------------

describe('hasDefineScope', () => {
  it('returns true for [all]', () => {
    expect(hasDefineScope(['all'])).toBe(true);
  });

  it('returns true for [define]', () => {
    expect(hasDefineScope(['define'])).toBe(true);
  });

  it('returns false for [statements/write]', () => {
    expect(hasDefineScope(['statements/write'])).toBe(false);
  });

  it('returns true for [statements/write, define]', () => {
    expect(hasDefineScope(['statements/write', 'define'])).toBe(true);
  });

  it('returns false for empty scopes', () => {
    expect(hasDefineScope([])).toBe(false);
  });

  it('returns false for [all/read]', () => {
    expect(hasDefineScope(['all/read'])).toBe(false);
  });
});
