import { DomainError } from '@agorafab/domain';
import { requiredText } from '../http-validation.js';

export function repositoryUrl(value: unknown): string {
  const candidate = requiredText(value, 2048);
  const match =
    /^https:\/\/github\.com\/([a-zA-Z0-9][a-zA-Z0-9-]{0,38})\/([a-zA-Z0-9_.-]{1,100})\/?$/.exec(
      candidate,
    );
  if (!match?.[1] || !match[2] || match[2] === '.' || match[2] === '..') {
    throw new DomainError(
      422,
      'INVALID_REPOSITORY',
      'Enter an HTTPS GitHub repository URL.',
    );
  }
  return `https://github.com/${match[1]}/${match[2]}`;
}
