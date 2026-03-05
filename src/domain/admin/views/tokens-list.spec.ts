import { describe, expect, it } from 'vitest';
import { tokensPage } from './tokens-list.js';
import type { TokenRow, CreatedToken } from './tokens-list.js';
import type { TenantOption } from './statements-list.js';

const TENANTS: TenantOption[] = [
  { id: '11111111-1111-1111-1111-111111111111', name: 'Acme Corp' },
  { id: '22222222-2222-2222-2222-222222222222', name: 'Beta Inc' },
];

const TOKENS: TokenRow[] = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    tenant_id: '11111111-1111-1111-1111-111111111111',
    tenant_name: 'Acme Corp',
    user_sub: 'alice@example.com',
    scopes: ['all'],
    created_at: new Date('2024-01-01T00:00:00Z'),
  },
];

describe('tokensPage', () => {
  it('renders the create form with tenant options', () => {
    const html = tokensPage(TOKENS, '', TENANTS);
    expect(html).toContain('Create Token');
    expect(html).toContain('Acme Corp');
    expect(html).toContain('Beta Inc');
    expect(html).toContain('name="tenantId"');
    expect(html).toContain('name="userSub"');
    expect(html).toContain('name="scopes"');
  });

  it('renders scope checkboxes', () => {
    const html = tokensPage([], '', TENANTS);
    expect(html).toContain('value="all"');
    expect(html).toContain('value="statements/write"');
    expect(html).toContain('value="statements/read"');
    expect(html).toContain('value="state"');
    expect(html).toContain('value="define"');
    expect(html).toContain('value="profile"');
  });

  it('renders token rows with delete buttons', () => {
    const html = tokensPage(TOKENS, '', TENANTS);
    expect(html).toContain('alice@example.com');
    expect(html).toContain('hx-delete="/admin/tokens/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"');
    expect(html).toContain('Delete');
  });

  it('shows created token flash when provided', () => {
    const created: CreatedToken = {
      id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
      secret: 'my-secret-value',
    };
    const html = tokensPage(TOKENS, '', TENANTS, created);
    expect(html).toContain('Token created.');
    expect(html).toContain('bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb');
    expect(html).toContain('my-secret-value');
  });

  it('does not show flash when no token was created', () => {
    const html = tokensPage(TOKENS, '', TENANTS);
    expect(html).not.toContain('Token created.');
  });

  it('renders search input with current value', () => {
    const html = tokensPage(TOKENS, 'alice', TENANTS);
    expect(html).toContain('value="alice"');
  });
});
