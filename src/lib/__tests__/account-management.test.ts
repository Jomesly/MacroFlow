import { describe, expect, it } from 'vitest';
import { accountError, accountIdSchema, accountPatchSchema, accountRemovalSchema, userDeletionSchema } from '../account-management';

const operation = { expectedVersion: 1, operationId: 'a0000000-0000-4000-8000-000000000001' };

describe('account management inputs', () => {
  it('rejects invalid IDs and uneditable broker identity fields', () => {
    for (const id of ['0', '-1', '1.2', '1e3', '9007199254740993', 'abc']) expect(accountIdSchema.safeParse(id).success).toBe(false);
    expect(accountIdSchema.parse('42')).toBe(42);
    expect(accountPatchSchema.safeParse({ ...operation, action: 'edit', displayName: 'Main', notes: '', server: 'Another broker' }).success).toBe(false);
  });
  it('validates lengths and separates editing from sync actions', () => {
    expect(accountPatchSchema.parse({ ...operation, action: 'edit', displayName: '  Main  ', notes: '  note  ' })).toEqual({ ...operation, action: 'edit', displayName: 'Main', notes: 'note' });
    expect(accountPatchSchema.safeParse({ ...operation, action: 'edit', displayName: 'a'.repeat(81), notes: '' }).success).toBe(false);
    expect(accountPatchSchema.safeParse({ ...operation, action: 'edit', displayName: '', notes: 'a'.repeat(1001) }).success).toBe(false);
    expect(accountPatchSchema.safeParse({ ...operation, action: 'resume', displayName: 'Main' }).success).toBe(false);
    expect(accountPatchSchema.safeParse({ ...operation, action: 'reconnect' }).success).toBe(false);
  });
  it('requires an explicit history choice and exact user-deletion confirmation', () => {
    expect(accountRemovalSchema.safeParse({}).success).toBe(false);
    expect(accountRemovalSchema.safeParse({ ...operation, deleteTrades: 'true' }).success).toBe(false);
    expect(accountRemovalSchema.parse({ ...operation, deleteTrades: false })).toEqual({ ...operation, deleteTrades: false, confirmation: '' });
    expect(userDeletionSchema.safeParse({ password: 'secret', confirmation: 'delete' }).success).toBe(false);
    expect(userDeletionSchema.safeParse({ password: '', confirmation: 'DELETE' }).success).toBe(false);
    expect(userDeletionSchema.safeParse({ password: 'secret', confirmation: 'DELETE', userId: 'someone-else' }).success).toBe(false);
  });
  it('maps lifecycle conflicts without exposing database details', () => {
    expect(accountError({ message: 'ACCOUNT_REMOVED' })).toMatchObject({ status: 409, code: 'ACCOUNT_REMOVED' });
    expect(accountError({ message: 'ACCOUNT_NOT_FOUND' })).toMatchObject({ status: 404 });
    expect(accountError({ message: 'ACCOUNT_DELETING' })).toMatchObject({ status: 403 });
    const failure = accountError({ message: 'secret constraint details' });
    expect(failure.status).toBe(503);
    expect(failure.error).not.toContain('secret');
  });
});
