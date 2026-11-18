import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from 'playwright';
import { expect } from 'vitest';

export async function checkPage(page: Page, label: string) {
  const widths = await page.locator('html').evaluate((html) => ({
    content: html.scrollWidth,
    viewport: html.clientWidth,
  }));
  expect(widths.content, `${label} fits the viewport`).toBeLessThanOrEqual(
    widths.viewport + 1,
  );
  const headings = page.getByRole('main').getByRole('heading', { level: 1 });
  expect(await headings.count(), `${label} has a single main heading`).toBe(1);
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map(({ target }) => target),
    })),
    `${label} automated accessibility violations`,
  ).toEqual([]);
}

export async function tabTo(page: Page, target: Locator) {
  await target.waitFor();
  for (let step = 0; step < 20; step += 1) {
    if (await target.evaluate((element) => element.matches(':focus-visible')))
      return;
    await page.keyboard.press('Tab');
  }
  throw new Error('Expected control could not be reached with Tab.');
}
