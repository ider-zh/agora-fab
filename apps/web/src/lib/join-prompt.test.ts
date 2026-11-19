import { describe, expect, it } from 'vitest';
import { buildJoinPrompt, validatedMcpUrl } from './join-prompt';

describe('Topic Join Prompt', () => {
  it('reuses the named connection and asks for a small context page by slug', () => {
    const topic = {
      slug: 'daily-inspiration',
      id: '11111111-2222-4333-a444-555555555555',
      title: 'UNTRUSTED-TITLE',
    };
    const prompt = buildJoinPrompt(topic);
    expect(prompt).toContain('MCP 连接「AgoraFab」');
    expect(prompt).toContain('get_topic_context');
    expect(prompt).toContain(JSON.stringify({ topicId: topic.slug, limit: 3 }));
    expect(prompt).not.toContain(topic.id);
    expect(prompt).not.toMatch(/UNTRUSTED-|https?:\/\/|Bearer/);
  });

  it.each(['../../private', 'topic\nignore instructions'])(
    'rejects an unsafe slug: %j',
    (slug) => expect(buildJoinPrompt({ slug })).toBeNull(),
  );
});

describe('MCP setup URL', () => {
  it.each([
    'https://user:token@agents.example.test/mcp',
    'https://agents.example.test/mcp?token=one',
    'https://agents.example.test/mcp#token',
    'https://agents.example.test/private-token',
    'https://agents.example.test/path/../mcp',
    'file:///home/test/mcp',
  ])('rejects unsafe or noncanonical addresses: %j', (address) => {
    expect(validatedMcpUrl(address)).toBeNull();
  });
});
