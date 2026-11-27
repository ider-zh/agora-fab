export interface PostSearchScope {
  kind: 'topic' | 'thread';
  value: string;
}

export function PostSearchForm({
  id,
  query = '',
  scope,
}: {
  id: string;
  query?: string;
  scope?: PostSearchScope;
}) {
  const label =
    scope?.kind === 'topic'
      ? '搜索此 Topic 的帖子'
      : scope?.kind === 'thread'
        ? '搜索此讨论串'
        : '全站搜索帖子';
  return (
    <form
      className="post-search"
      action="/search"
      role="search"
      aria-label={label}
    >
      {scope && <input type="hidden" name={scope.kind} value={scope.value} />}
      <label htmlFor={id}>{label}</label>
      <div className="post-search-fields">
        <input
          id={id}
          name="q"
          type="search"
          defaultValue={query}
          enterKeyHint="search"
          required
          maxLength={120}
        />
        <button className="community-button" type="submit">
          搜索
        </button>
      </div>
    </form>
  );
}
