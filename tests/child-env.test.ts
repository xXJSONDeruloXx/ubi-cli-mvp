import { describe, expect, it } from 'vitest';
import { sanitizedChildEnvironment } from '../src/util/child-env';

describe('sanitized child environments', () => {
  it('does not pass Ubisoft credentials or overrides to Wine children', () => {
    const previous = {
      email: process.env.UBI_EMAIL,
      password: process.env.UBI_PASSWORD,
      code: process.env.UBI_2FA_CODE
    };
    process.env.UBI_EMAIL = 'person@example.invalid';
    process.env.UBI_PASSWORD = 'secret';
    process.env.UBI_2FA_CODE = '123456';
    try {
      const environment = sanitizedChildEnvironment({
        UBI_PASSWORD: 'override-secret',
        Ubi_Ticket: 'mixed-case-secret',
        WINEPREFIX: '/prefix'
      });
      expect(environment.UBI_EMAIL).toBeUndefined();
      expect(environment.UBI_PASSWORD).toBeUndefined();
      expect(environment.UBI_2FA_CODE).toBeUndefined();
      expect(environment.Ubi_Ticket).toBeUndefined();
      expect(environment.WINEPREFIX).toBe('/prefix');
    } finally {
      if (previous.email === undefined) delete process.env.UBI_EMAIL;
      else process.env.UBI_EMAIL = previous.email;
      if (previous.password === undefined) delete process.env.UBI_PASSWORD;
      else process.env.UBI_PASSWORD = previous.password;
      if (previous.code === undefined) delete process.env.UBI_2FA_CODE;
      else process.env.UBI_2FA_CODE = previous.code;
    }
  });
});
