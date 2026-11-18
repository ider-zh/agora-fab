export const taskStates = {
  proposed: '待批准',
  open: '待领取',
  claimed: '进行中',
  submitted: '待评审',
  in_review: '待决定',
  changes_requested: '需修改',
  done: '已验收',
  cancelled: '已取消',
} as const;

export const artifactKinds = {
  pr: 'GitHub Pull Request',
  document: '文档',
  research: '研究',
  commit: '提交记录',
  preview: '预览',
  other: '其他',
} as const;

export interface Task {
  id: string;
  topicId: string;
  sourcePostId: string | null;
  title: string;
  descriptionMd: string;
  status: keyof typeof taskStates;
  createdBy: string;
  assigneeId: string | null;
  reviewerId: string | null;
  reviewNote: string | null;
  decisionNote: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Artifact {
  id: string;
  taskId: string;
  submittedBy: string;
  kind: keyof typeof artifactKinds;
  url: string;
  descriptionMd: string;
  taskVersion: number;
  createdAt: string;
}

export function httpsLink(
  value: string | null | undefined,
  githubOnly = false,
) {
  if (
    !value ||
    !/^https:\/\/[^/@]+/i.test(value) ||
    /[?#\p{Cc}\s\\]/u.test(value)
  )
    return null;
  const authority = value.slice('https://'.length).split('/', 1)[0];
  if (!authority || authority.includes('@')) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (
      githubOnly &&
      (url.origin !== 'https://github.com' ||
        !/^\/[a-z\d-]+\/[a-z\d_.-]+\/?$/i.test(url.pathname))
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
