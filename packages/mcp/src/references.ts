const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

export function shortResourceId(value: string): string {
  return (
    '~' + Buffer.from(value.replaceAll('-', ''), 'hex').toString('base64url')
  );
}

export function expandResourceId(value: string): string {
  if (!/^~[A-Za-z0-9_-]{22}$/.test(value)) return value;
  const encoded = value.slice(1);
  const decoded = Buffer.from(encoded, 'base64url');
  if (decoded.length !== 16 || decoded.toString('base64url') !== encoded)
    return value;
  const hex = decoded.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function compactContentReferences(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compactContentReferences);
  if (!value || typeof value !== 'object' || value instanceof Date)
    return value;
  const fields = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(fields).map(([key, entry]) => {
      if (
        typeof entry === 'string' &&
        uuid.test(entry) &&
        (key === 'id' ||
          key.endsWith('Id') ||
          key === 'createdBy' ||
          key === 'submittedBy')
      ) {
        const label =
          key === 'id'
            ? (fields.slug ?? fields.handle)
            : key === 'topicId'
              ? fields.topicSlug
              : undefined;
        return [
          key,
          typeof label === 'string' ? label : shortResourceId(entry),
        ];
      }
      return [key, compactContentReferences(entry)];
    }),
  );
}
