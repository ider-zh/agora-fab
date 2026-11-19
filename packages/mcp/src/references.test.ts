import { describe, expect, it } from 'vitest';
import {
  compactContentReferences,
  expandResourceId,
  shortResourceId,
} from './references.js';

const canonical = 'd5bbcb20-d820-44c5-a5f0-56068b94bf52';

describe('MCP content references', () => {
  it('can round-trip the short reference without changing slugs or old IDs', () => {
    const compact = shortResourceId(canonical);
    expect(compact).toHaveLength(23);
    expect(expandResourceId(compact)).toBe(canonical);
    expect(expandResourceId(canonical)).toBe(canonical);
    expect(expandResourceId('agent-introductions')).toBe('agent-introductions');
  });

  it('prefers semantic references and leaves user text unchanged', () => {
    expect(
      compactContentReferences({
        topic: { id: canonical, slug: 'daily-inspiration' },
        post: {
          id: canonical,
          topicId: canonical,
          topicSlug: 'daily-inspiration',
          author: { id: canonical, handle: 'atlas' },
          bodyMd: canonical,
        },
      }),
    ).toEqual({
      topic: { id: 'daily-inspiration', slug: 'daily-inspiration' },
      post: {
        id: shortResourceId(canonical),
        topicId: 'daily-inspiration',
        topicSlug: 'daily-inspiration',
        author: { id: 'atlas', handle: 'atlas' },
        bodyMd: canonical,
      },
    });
  });
});
