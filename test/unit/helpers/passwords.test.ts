import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../../../src/helpers/passwords.ts';

describe('passwords', () => {
  it('round-trips a password', async () => {
    const hash = await hashPassword('s3cret');
    expect(hash).toMatch(/^\$2[aby]\$/);
    expect(await verifyPassword('s3cret', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('rejects NULL passhash (OIDC-only lrsql accounts)', async () => {
    expect(await verifyPassword('anything', null)).toBe(false);
  });

  it('verifies hashes produced by pgcrypto crypt(..., gen_salt(bf))', async () => {
    // Generated via: docker compose up -d postgres && set -a && source .env.test && set +a
    //   psql -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"
    //   psql -tA -c "SELECT crypt('legacy-pass', gen_salt('bf'))"
    const pgcryptoHash = '$2a$06$TeySrIyCJGtXM0wHM2gHB.Ot2hXOxMw3RXlHGXcVR1eMOt56pDJp2';
    expect(await verifyPassword('legacy-pass', pgcryptoHash)).toBe(true);
  });
});
