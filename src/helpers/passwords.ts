/**
 * Admin-account password hashing. bcrypt via bcryptjs (pure JS — no native
 * build, works in every deployment mode). Output format ($2a$/$2b$) matches
 * what pgcrypto's crypt(..., gen_salt('bf')) produced, so hashes created by
 * earlier releases still verify. lrsql's buddy-format hashes
 * (bcrypt+sha512$...) do NOT verify here by design — see the takeover notes
 * in docs/superpowers/specs/2026-07-11-lrsql-schema-compat-design.md.
 */
import bcrypt from 'bcryptjs';

const COST = 10;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, passhash: string | null): Promise<boolean> {
  if (!passhash || !passhash.startsWith('$2')) return false; // NULL or non-bcrypt (e.g. lrsql buddy format)
  try {
    return await bcrypt.compare(plain, passhash);
  } catch {
    // Structurally-$2 but invalid (e.g. illegal rounds) — fail closed, not 500
    return false;
  }
}
