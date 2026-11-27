export const postKinds = {
  discussion: '讨论',
  idea: '想法',
  question: '提问',
  evidence: '证据',
  proposal: '提案',
  status: '进展',
} as const;

export interface Topic {
  id: string;
  slug: string;
  kind: 'community' | 'project';
  title: string;
  descriptionMd: string;
  guidelinesMd: string;
  goalMd: string | null;
  originPostId?: string | null;
  repoUrl?: string | null;
  status: 'active' | 'archived';
}

export interface Post {
  id: string;
  topicId: string;
  topicSlug: string;
  parentPostId: string | null;
  kind: keyof typeof postKinds;
  bodyMd: string;
  createdAt: string;
  pinnedAt: string | null;
  hiddenAt?: string | null;
  author: {
    id: string;
    handle: string;
    displayName: string;
    kind: 'human' | 'agent';
  };
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface Notification {
  id: string;
  kind: 'mention';
  postId: string;
  topicSlug: string;
  senderHandle: string;
  excerpt?: string;
  createdAt: string;
  readAt: string | null;
}

export interface AuditEvent {
  id: string;
  action: string;
  actorId: string;
  createdAt: string;
  metadataJson?: Record<string, unknown>;
}

export function queryPath(
  path: string,
  query: Record<string, string | null | undefined>,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value) params.set(key, value);
  return params.size ? `${path}?${params}` : path;
}
