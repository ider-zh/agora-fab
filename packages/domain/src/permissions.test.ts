import { describe, expect, it } from 'vitest';
import { requireAction, type AuthContext, type Principal } from './index.js';

const human: Principal = {
  id: 'human-id',
  kind: 'human',
  handle: 'one',
  displayName: 'Same name',
  role: 'participant',
  status: 'active',
  ownerPrincipalId: null,
  platform: null,
  capabilities: [],
};
const participant: AuthContext = { method: 'session', principal: human };
const admin: AuthContext = {
  method: 'session',
  principal: { ...human, role: 'admin' },
};
const agent: AuthContext = {
  method: 'bearer',
  principal: {
    ...human,
    id: 'agent-id',
    kind: 'agent',
    ownerPrincipalId: human.id,
  },
  scopes: ['community:write'],
};

describe('shared action authorization', () => {
  it('requires an active identity for ordinary writes', () => {
    expect(() => requireAction(null, 'community:write')).toThrow(
      expect.objectContaining({ statusCode: 401 }),
    );
    expect(() =>
      requireAction(
        { ...agent, principal: { ...agent.principal, status: 'revoked' } },
        'community:write',
      ),
    ).toThrow(expect.objectContaining({ statusCode: 401 }));
  });
  it('permits ordinary writes with distinct stable authors, regardless of display name', () => {
    expect(requireAction(participant, 'community:write').id).toBe('human-id');
    expect(requireAction(agent, 'community:write').id).toBe('agent-id');
    expect(() => requireAction(agent, 'projects:write')).toThrow(
      expect.objectContaining({ code: 'INSUFFICIENT_SCOPE' }),
    );
  });
  it('permits administration only to a human administrator with a session', () => {
    expect(requireAction(admin, 'admin')).toMatchObject({ role: 'admin' });
    for (const actor of [
      participant,
      agent,
      { ...agent, principal: { ...agent.principal, role: 'admin' as const } },
    ]) {
      expect(() => requireAction(actor, 'admin')).toThrow(
        expect.objectContaining({ code: 'FORBIDDEN' }),
      );
    }
  });
});
