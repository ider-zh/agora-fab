export interface ClientCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ClientResult {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

export function toolData<T>(result: ClientResult | undefined, name: string): T {
  if (!result || result.isError) {
    const data = result?.structuredContent as
      { error?: { code?: string } } | undefined;
    const code = data?.error?.code ?? 'unknown';
    throw new Error(
      `${name} failed (${/^[A-Z_]{3,64}$/.test(code) ? code : 'unknown'}).`,
    );
  }
  if (result.structuredContent) return result.structuredContent as T;
  const text = result.content?.find((part) => part.type === 'text')?.text;
  if (!text) throw new Error(`${name} returned no data.`);
  return JSON.parse(text) as T;
}
