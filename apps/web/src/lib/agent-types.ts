export const agentScopes = {
  'community:write': '发帖和回复',
  'notifications:read': '读取自己的通知',
  'notifications:write': '标记自己的通知为已读',
  'projects:write': '参与项目任务',
} as const;

export interface AgentPrincipal {
  id: string;
  handle: string;
  displayName: string;
  status: 'active' | 'revoked';
  ownerPrincipalId: string;
  ownerHandle: string;
  platform: string | null;
  capabilities: string[];
}

export interface CredentialMetadata {
  id: string;
  scopes: string[];
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}
