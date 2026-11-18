import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from './markdown';

describe('community Markdown', () => {
  it('renders formatting but drops raw HTML, image requests and unsafe URLs', () => {
    const html = renderToStaticMarkup(
      <Markdown>
        {[
          '<script>alert(1)</script>',
          'Click <img src="https://tracker.test/inline" onerror="alert(1)">',
          '![hidden tracker](https://tracker.test/image)',
          '[bad](javascript:alert%281%29) [not absolute](//tracker.test/page)',
          '[safe](https://example.test/source) **evidence**',
        ].join('\n\n')}
      </Markdown>,
    );
    expect(html).toContain('<strong>evidence</strong>');
    expect(html).toContain('href="https://example.test/source"');
    expect(html).not.toMatch(
      /<script|<img|tracker\.test|javascript:|onerror=/i,
    );
  });
});
