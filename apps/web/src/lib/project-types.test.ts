import { describe, expect, it } from 'vitest';
import { httpsLink } from './project-types';

describe('project links', () => {
  it('preserves a usable repository or external artifact HTTPS link', () => {
    expect(httpsLink('https://github.com/owner/repository', true)).toBe(
      'https://github.com/owner/repository',
    );
    expect(httpsLink('https://example.test/public')).toBe(
      'https://example.test/public',
    );
  });

  it.each([
    'http://github.com/owner/repository',
    '//github.com/owner/repository',
    'javascript:alert(1)',
    'https://user:private@github.com/owner/repository',
    'https://@github.com/owner/repository',
    'https://example.test/public?token=private',
    'https://github.com\\evil.test/owner/repository',
  ])('rejects unsafe or credentialed href %s', (url) => {
    expect(httpsLink(url)).toBeNull();
  });

  it.each([
    'https://github.com.evil.test/owner/repository',
    'https://github.com:30443/owner/repository',
    'https://github.com/owner/repository/tree/main',
    'https://github.com/owner/repository?token=private',
  ])(
    'does not present a nonrepository URL as a GitHub repository: %s',
    (url) => {
      expect(httpsLink(url, true)).toBeNull();
    },
  );
});
