import { DomainError } from '@agorafab/domain';
import { repositoryUrl } from '../projects/repository.js';
import {
  invalidInput,
  requiredText,
  verifiedObject,
} from '../http-validation.js';

export const postKinds = [
  'discussion',
  'idea',
  'question',
  'evidence',
  'proposal',
  'status',
] as const;
export type PostKind = (typeof postKinds)[number];
const handlePattern = /^[a-z][a-z0-9_]{2,31}$/;

function mentionableText(bodyMd: string) {
  let fence: string | undefined;
  const lines: string[] = [];
  for (const line of bodyMd.split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker?.[1]?.startsWith(fence) && !marker[2]?.trim())
        fence = undefined;
    } else if (marker?.[1]) {
      fence = marker[1];
    } else if (!/^(?: {4}|\t)/.test(line)) {
      lines.push(line);
    }
  }
  return lines
    .join('\n')
    .replace(/`+[^`\n]*`+|\]\([^\n)]*\)|https?:\/\/[^\s)]+/g, ' ');
}

export function postInput(value: unknown) {
  const body = verifiedObject(value, ['bodyMd', 'kind', 'mentions']);
  const bodyMd = requiredText(body.bodyMd, 12_000);
  const kind = body.kind ?? 'discussion';
  if (typeof kind !== 'string' || !postKinds.includes(kind as PostKind))
    invalidInput();
  const explicit = body.mentions ?? [];
  if (!Array.isArray(explicit) || explicit.length > 10) invalidInput();
  const handles = new Set(
    explicit.map((value: unknown) => {
      const handle = requiredText(value, 33).replace(/^@/, '').toLowerCase();
      if (!handlePattern.test(handle)) invalidInput();
      return handle;
    }),
  );
  // Ignore fenced/inline examples, links, email addresses, and escaped mentions.
  const prose = mentionableText(bodyMd);
  for (const match of prose.matchAll(
    /(?:^|[^a-z0-9_@\\.+-])@([a-z][a-z0-9_]{2,31})(?![a-z0-9_@])/gi,
  )) {
    if (match[1]) handles.add(match[1].toLowerCase());
  }
  if (handles.size > 10)
    throw new DomainError(
      422,
      'MENTION_LIMIT',
      'A post can mention up to 10 principals.',
    );
  return { bodyMd, kind: kind as PostKind, mentions: [...handles].sort() };
}

export type PostInput = ReturnType<typeof postInput>;

function optionalMarkdown(value: unknown, max: number): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    value.includes('\u0000')
  )
    invalidInput();
  return value.trim();
}

export function newTopicInput(value: unknown) {
  const body = verifiedObject(value, [
    'slug',
    'title',
    'kind',
    'descriptionMd',
    'guidelinesMd',
    'goalMd',
  ]);
  const slug = requiredText(body.slug, 100);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) invalidInput();
  const kind = body.kind ?? 'community';
  if (kind !== 'community' && kind !== 'project') invalidInput();
  const goalMd = kind === 'project' ? requiredText(body.goalMd, 4000) : null;
  if (kind === 'community' && body.goalMd != null) invalidInput();
  return {
    slug,
    kind,
    title: requiredText(body.title, 200),
    descriptionMd: optionalMarkdown(body.descriptionMd ?? '', 4000),
    guidelinesMd: optionalMarkdown(body.guidelinesMd ?? '', 4000),
    goalMd,
  } as const;
}

export function topicPatch(value: unknown) {
  const body = verifiedObject(value, [
    'title',
    'descriptionMd',
    'guidelinesMd',
    'goalMd',
    'status',
    'repoUrl',
  ]);
  const status = body.status;
  if (status !== undefined && status !== 'active' && status !== 'archived')
    invalidInput();
  const patch = {
    ...(body.title === undefined
      ? {}
      : { title: requiredText(body.title, 200) }),
    ...(body.descriptionMd === undefined
      ? {}
      : { descriptionMd: optionalMarkdown(body.descriptionMd, 4000) }),
    ...(body.guidelinesMd === undefined
      ? {}
      : { guidelinesMd: optionalMarkdown(body.guidelinesMd, 4000) }),
    ...(body.goalMd === undefined
      ? {}
      : { goalMd: requiredText(body.goalMd, 4000) }),
    ...(body.repoUrl === undefined
      ? {}
      : {
          repoUrl: body.repoUrl === null ? null : repositoryUrl(body.repoUrl),
        }),
    ...(status === undefined ? {} : { status }),
  } as {
    title?: string;
    descriptionMd?: string;
    guidelinesMd?: string;
    goalMd?: string;
    repoUrl?: string | null;
    status?: 'active' | 'archived';
  };
  if (!Object.keys(patch).length) invalidInput();
  return patch;
}
