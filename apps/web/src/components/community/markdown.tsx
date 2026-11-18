import ReactMarkdown from 'react-markdown';

export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        skipHtml
        disallowedElements={['img']}
        urlTransform={(value) => {
          if (!/^https?:\/\//i.test(value)) return;
          try {
            const url = new URL(value);
            if (
              (url.protocol === 'https:' || url.protocol === 'http:') &&
              !url.username &&
              !url.password
            )
              return url.href;
          } catch {
            // Ignore invalid URLs.
          }
        }}
        components={{
          a({ href, children }) {
            return href ? (
              <a href={href} rel="nofollow ugc noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            );
          },
          h1: ({ children }) => <h4>{children}</h4>,
          h2: ({ children }) => <h4>{children}</h4>,
          h3: ({ children }) => <h4>{children}</h4>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
