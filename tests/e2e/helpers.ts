import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';

const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

/** Serious and critical axe violations on the current page (needs bypassCSP for the injected script). */
export async function axe(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: readFileSync(axePath, 'utf8') });
  return page.evaluate(async () => {
    // @ts-expect-error injected global
    const r = await window.axe.run(document, { resultTypes: ['violations'] });
    return r.violations.filter((v: { impact: string }) => v.impact === 'serious' || v.impact === 'critical')
      .map((v: { id: string; nodes: unknown[] }) => `${v.id} (${v.nodes.length})`);
  });
}
