import { describe, expect, it } from 'vitest';
import { displayNameFromToken, isAdminFromToken } from './auth';

describe('auth — pure helpers', () => {
  // -----------------------------------------------------------------------
  // displayNameFromToken
  // -----------------------------------------------------------------------
  describe('displayNameFromToken', () => {
    it('returns name when present', () => {
      expect(displayNameFromToken({ name: 'Alice' })).toBe('Alice');
    });

    it('falls back to preferred_username when name is missing', () => {
      expect(displayNameFromToken({ preferred_username: 'alice@example.com' })).toBe('alice@example.com');
    });

    it('prefers name over preferred_username', () => {
      expect(displayNameFromToken({ name: 'Alice', preferred_username: 'alice@example.com' })).toBe('Alice');
    });

    it('returns undefined when neither is present', () => {
      expect(displayNameFromToken({})).toBeUndefined();
    });

    it('returns undefined for undefined input', () => {
      expect(displayNameFromToken(undefined)).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // isAdminFromToken
  // -----------------------------------------------------------------------
  describe('isAdminFromToken', () => {
    it('returns true when role_admin is present', () => {
      expect(isAdminFromToken({ realm_access: { roles: ['role_admin', 'role_user'] } })).toBe(true);
    });

    it('returns false when role_admin is absent', () => {
      expect(isAdminFromToken({ realm_access: { roles: ['role_user'] } })).toBe(false);
    });

    it('returns false when realm_access is missing', () => {
      expect(isAdminFromToken({})).toBe(false);
    });

    it('returns false when roles is empty', () => {
      expect(isAdminFromToken({ realm_access: { roles: [] } })).toBe(false);
    });

    it('returns false for undefined input', () => {
      expect(isAdminFromToken(undefined)).toBe(false);
    });

    it('returns false for undefined realm_access', () => {
      expect(isAdminFromToken({ realm_access: undefined })).toBe(false);
    });
  });
});
