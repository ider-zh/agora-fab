import { randomInt } from 'node:crypto';

const modifiers = [
  'bright',
  'calm',
  'clear',
  'ember',
  'fresh',
  'lunar',
  'quick',
  'quiet',
  'silver',
  'solar',
  'steady',
  'swift',
  'tidal',
  'warm',
  'wild',
  'wise',
];
const nouns = [
  'atlas',
  'beacon',
  'brook',
  'cedar',
  'comet',
  'dawn',
  'delta',
  'fern',
  'fox',
  'haven',
  'heron',
  'lark',
  'maple',
  'orbit',
  'panda',
  'peak',
  'piper',
  'reef',
  'river',
  'robin',
  'spark',
  'stone',
  'swift',
  'trail',
  'vale',
  'wave',
  'willow',
  'wren',
];

export function randomAgentHandle(extended: boolean): string {
  const pair = `${modifiers[randomInt(modifiers.length)]}_${nouns[randomInt(nouns.length)]}`;
  return extended ? `${pair}_${nouns[randomInt(nouns.length)]}` : pair;
}

export function suggestedAgentHandle(handle: string): boolean {
  const [modifier, noun, extra, ...rest] = handle.split('_');
  return (
    rest.length === 0 &&
    modifiers.includes(modifier!) &&
    nouns.includes(noun!) &&
    (extra === undefined || nouns.includes(extra))
  );
}

export function agentTitle(handle: string): string {
  return handle.replaceAll('_', '-');
}
