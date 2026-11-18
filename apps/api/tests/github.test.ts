import { describe, expect, it, vi } from 'vitest';
import { createGitHubProvider } from '../src/auth/github.js';

const exchangeInput = {
  code: 'fixture-code',
  codeVerifier: 'fixture-verifier',
  redirectUri: 'https://example.test/api/auth/github/callback',
  clientId: 'fixture-client-id',
  clientSecret: 'fixture-client-secret',
};

describe('GitHub OAuth provider', () => {
  it('exchanges only with the fixed GitHub endpoints and maps the stable profile ID', async () => {
    const fetcher = vi.fn<typeof fetch>();
    fetcher.mockResolvedValueOnce(
      Response.json({ access_token: 'gho_fixture' }),
    );
    fetcher.mockResolvedValueOnce(
      Response.json({
        id: 81202,
        login: 'renamed-user',
        name: '  Example Human ',
        email: 'fixture@example.test',
      }),
    );

    await expect(
      createGitHubProvider(fetcher).exchange(exchangeInput),
    ).resolves.toEqual({
      id: '81202',
      login: 'renamed-user',
      displayName: 'Example Human',
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'https://github.com/login/oauth/access_token',
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
      }),
    );
    const form = fetcher.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(Object.fromEntries(form)).toEqual({
      code: 'fixture-code',
      code_verifier: 'fixture-verifier',
      redirect_uri: exchangeInput.redirectUri,
      client_id: 'fixture-client-id',
      client_secret: 'fixture-client-secret',
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'https://api.github.com/user',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer gho_fixture',
        }),
        redirect: 'error',
      }),
    );
  });

  it.each([
    { error: 'bad_verification_code' },
    { access_token: 'token\r\nwith\r\nline-breaks' },
    { access_token: '' },
    null,
  ])(
    'rejects malformed token exchanges before querying the profile',
    async (body) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json(body));
      await expect(
        createGitHubProvider(fetcher).exchange(exchangeInput),
      ).rejects.toThrow('usable access token');
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { id: '81202', login: 'someone' },
    { id: Number.MAX_SAFE_INTEGER + 1, login: 'someone' },
    { id: 81202, login: '' },
  ])('rejects profiles without a valid provider identity', async (body) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: 'gho_fixture' }))
      .mockResolvedValueOnce(Response.json(body));
    await expect(
      createGitHubProvider(fetcher).exchange(exchangeInput),
    ).rejects.toThrow('invalid profile');
  });
});
