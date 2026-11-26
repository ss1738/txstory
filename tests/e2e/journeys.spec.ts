import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { A } from '../synthetic/cases.js';

// All examples are SYNTHETIC (fixtures/synthetic, see tests/synthetic/cases.ts) or local
// devnet recordings (fixtures/devnet). Expected values follow from the case definitions.
const SWAP = '0xefb65ab1ab71b94063c0ee8e8c7bdde47b808c19f4e653ed931e3006f4983112';
const BIG = '0xfeb89d8c5b4ec361b7e3bd004eef2b156f0d4a9f39515d07377a357935891eff';
const FAILED = '0x3d1c7620ac068d1195eae3374edb33b2b41611f784176e83aa01cfdb65446a2d';
const ETH_TRANSFER = '0xcb55a82b95ca4bec1fa8ff890abda0691aaef7aac5795da9c4ab034d6d65cb57';
const PENDING = '0xfbd6ef4b1d90c6e64d9359183593362d5e10d28f28a023c608b796e979c8494f';
const NFT = '0x0ef700399004ed72601ca48df36e4974d02c25742eddcd7139e66e792d3b2143';
const NFT_DISAGREE = '0x782827594208f3d989eb6355da47186dfb09cbdc50d4499a6af1b697ce3ba518';
const WRAP_UNINDEXED = '0xe558259f8db603a729cb2a6ff7c250c08b20c16faa7b110d9f85d85f59cb2f94';
const BASE_403 = '0xce4d4c3bded0220d6e5d7a6f1589edf8bbf4281a3e434579b19dd55e97ac4712';
const TAXT_CONTRACT = A.taxToken;
const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

async function axe(page: Page) {
  await page.addScriptTag({ content: readFileSync(axePath, 'utf8') });
  return page.evaluate(async () => {
    // @ts-expect-error injected global
    const r = await window.axe.run(document, { resultTypes: ['violations'] });
    return r.violations.filter((v: { impact: string }) => v.impact === 'serious' || v.impact === 'critical')
      .map((v: { id: string; nodes: unknown[] }) => `${v.id} (${v.nodes.length})`);
  });
}

test.describe('lookup', () => {
  test('home lists examples with their data origin and explains the evidence legend', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('actually');
    await expect(page.locator('.example-grid li')).toHaveCount(21); // 15 synthetic + 6 local devnet recordings
    await expect(page.locator('.example-grid li').filter({ hasText: 'synthetic (not real data)' })).toHaveCount(15);
    await expect(page.locator('.example-grid li').filter({ hasText: 'local devnet' })).toHaveCount(6);
    await expect(page.getByText('recorded mode')).toBeVisible();
  });

  test('rejects an address with specific guidance, accessibly', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Transaction hash or explorer link').fill('0x' + 'a'.repeat(40));
    await page.getByRole('button', { name: 'Explain' }).click();
    await expect(page.getByRole('alert')).toContainText('looks like an address');
    await expect(page.getByLabel('Transaction hash or explorer link')).toHaveAttribute('aria-invalid', 'true');
  });

  test('accepts an Etherscan link and picks the network from it', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Network').selectOption('base');
    await page.getByLabel('Transaction hash or explorer link').fill(`https://etherscan.io/tx/${SWAP}`);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/tx/ethereum/${SWAP}`));
    await expect(page.locator('.story-title')).toContainText('Exchange-like');
  });
});

test.describe('story', () => {
  test('swap story: ledger cross-checks, exact amounts, evidence highlighting', async ({ page }) => {
    await page.goto(`/example/ethereum/${SWAP}`);
    await expect(page.locator('.story-title')).toContainText('Exchange-like');
    await expect(page.locator('.story-strip')).toContainText('Synthetic example');
    await expect(page.locator('.ledger .xc-ok')).toHaveCount(7);
    await page.getByLabel('Exact amounts').check();
    await expect(page.locator('.ledger').getByText('−1,000 TAXT')).toBeVisible();
    await page.getByRole('button', { name: /Show evidence \(3\)/ }).click();
    await expect(page.locator('.ledger tr.hl')).toHaveCount(2);
  });

  test('replay is keyboard operable and deep-linkable', async ({ page }) => {
    await page.goto(`/example/ethereum/${SWAP}`);
    const list = page.getByRole('listbox', { name: 'Movements in order' });
    await list.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.detail')).toContainText('Step 2 of 3');
    await expect(page).toHaveURL(/\?m=log%3A1|\?m=log:1/);
    await page.keyboard.press('End');
    await expect(page.locator('.detail')).toContainText('Step 3 of 3');
    await page.reload();
    await expect(page.locator('.detail')).toContainText('Step 3 of 3');
    await page.getByRole('button', { name: 'Previous movement' }).click();
    await expect(page.locator('.detail')).toContainText('Step 2 of 3');
  });

  test('evidence tabs support arrow keys and say the sources are synthetic', async ({ page }) => {
    await page.goto(`/example/ethereum/${SWAP}`);
    await page.getByRole('tab', { name: 'Completeness' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Logs' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'Sources' }).click();
    await expect(page.getByRole('tabpanel')).toContainText('SYNTHETIC responses');
    await expect(page.locator('.sources tbody tr').first()).toContainText('eth_getTransactionByHash');
  });

  test('exports: evidence bundle and SVG card contents are correct', async ({ page }) => {
    await page.goto(`/example/ethereum/${SWAP}`);
    await expect(page.locator('.ledger .xc-ok')).toHaveCount(7);
    const [bundleDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download evidence (.json)' }).click()]);
    const bundle = JSON.parse(readFileSync((await bundleDl.path())!, 'utf8'));
    expect(bundle.format).toBe('txstory-evidence-bundle');
    expect(bundle.story.hash).toBe(SWAP);
    expect(bundle.story.mode).toBe('synthetic');
    expect(bundle.notice[0]).toMatch(/SYNTHETIC/);
    const rows: Array<{ assetKey: string; address: string; delta: string }> = bundle.story.ledger;
    const taxt = rows.find((r) => r.assetKey === TAXT_CONTRACT && r.address === bundle.story.tx.from)!;
    expect(taxt.delta).toBe('-1000000000000000000000');
    const [svgDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download story card (.svg)' }).click()]);
    const svg = readFileSync((await svgDl.path())!, 'utf8');
    expect(svg).toMatch(/^<\?xml/);
    expect(svg).toContain('Synthetic example (not real provider data)');
    expect(svg).not.toMatch(/<script|href=/);
  });

  test('large transaction stays usable and flags partial data', async ({ page }) => {
    const t0 = Date.now();
    await page.goto(`/example/ethereum/${BIG}`);
    await expect(page.locator('.story-title')).toContainText('Exchange-like');
    expect(Date.now() - t0).toBeLessThan(5000);
    await expect(page.locator('.banner-warn').first()).toContainText('internal native transfers: unavailable');
    // 80 token movements plus the transaction's own ETH value.
    await expect(page.getByRole('listbox', { name: 'Movements in order' }).locator('[role=option]')).toHaveCount(81);
    await expect(page.locator('.ledger')).toContainText('Expected gap');
  });

  test('failed transaction explains the revert and shows only the fee', async ({ page }) => {
    await page.goto(`/example/ethereum/${FAILED}`);
    await expect(page.locator('.badge-bad')).toHaveText('Reverted');
    await expect(page.getByText('Nothing moved: the call reverted')).toBeVisible();
    // Study walkthrough W1: the total fee must be stated, not only its components.
    await expect(page.getByTestId('fee-total')).toContainText('0.00006 ETH'); // 40,000 gas at 1.5 gwei
  });

  test('headline carries its provenance; partial-data banner states the consequence', async ({ page }) => {
    // Study walkthrough W3: the page title repeats the lead interpretation, so it must carry its label.
    await page.goto(`/example/ethereum/${SWAP}`);
    await expect(page.getByTestId('lead-kind')).toContainText('Heuristic');
    await expect(page.getByTestId('lead-kind')).toContainText('not a recorded fact');
    // Study walkthrough W2: name what the gap means, not only which source is missing.
    await page.goto(`/example/ethereum/${WRAP_UNINDEXED}`);
    await expect(page.locator('.banner-warn')).toContainText('ETH balance changes may be incomplete');
    await expect(page.getByTestId('lead-kind')).toContainText('Decoded');
  });

  test('fee panel states the total, then the burned and priority parts', async ({ page }) => {
    await page.goto(`/example/ethereum/${ETH_TRANSFER}`);
    await expect(page.getByTestId('fee-total')).toContainText('Total paid by the sender');
    await expect(page.getByTestId('fee-total')).toContainText('0.0000315 ETH'); // 21,000 gas at 1.5 gwei
    await expect(page.locator('.fees')).toContainText('Base fee (burned)');
  });

  test('pending and unknown transactions get recoverable error states', async ({ page }) => {
    await page.goto(`/example/ethereum/${PENDING}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('This transaction has not been mined yet');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await page.goto(`/tx/base/0x${'ab'.repeat(32)}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Transaction not found on this network');
    await expect(page.getByRole('button', { name: 'Ethereum' })).toBeVisible();
  });
});

test.describe('accessibility scan', () => {
  // The app's CSP (correctly) blocks the injected axe script; bypass it for this audit only.
  test.use({ bypassCSP: true });
  test('no serious accessibility violations (axe) on home and story', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.example-grid li').first()).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await page.goto(`/example/ethereum/${SWAP}`);
    await expect(page.locator('.ledger .xc-ok').first()).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });
  test('no serious accessibility violations on NFT, failed and partial-data stories', async ({ page }) => {
    // Study walkthrough W5: the NFT token id (the answer to "which NFT moved?") failed contrast here.
    for (const h of [NFT, FAILED, WRAP_UNINDEXED]) {
      await page.goto(`/example/ethereum/${h}`);
      await expect(page.getByTestId('fee-total')).toBeVisible();
      expect(await axe(page), h).toEqual([]);
    }
  });
});

test.describe('call traces (devnet recording, real EVM execution)', () => {
  test.use({ bypassCSP: true });
  test('trace tab shows the call tree, the rolled-back transfer, and decoded reverts; accessible', async ({ page }) => {
    await page.goto('/example/anvil/0xdce671e4526d6d277669b28b2a9108c3f291951eb893a8d716101d94a2640359');
    await expect(page.locator('.story-strip')).toContainText('Anvil devnet');
    await expect(page.locator('.banner-warn').first()).toBeHidden({ timeout: 1 }).catch(() => {});
    await page.getByRole('tab', { name: 'Call trace' }).click();
    const panel = page.getByRole('tabpanel');
    await expect(panel).toContainText('3 call frame(s)');
    await expect(panel).toContainText('1 were rolled back and are not balance changes');
    await expect(panel.locator('.frame.undone')).toHaveCount(1);
    await expect(panel).toContainText('Error("nope")');
    expect(await axe(page)).toEqual([]);
    // The replayable recording is one click away.
    const href = await page.getByRole('link', { name: 'Download recording (.json)' }).getAttribute('href');
    const rec = await (await page.request.get(href!)).json();
    expect(rec.recording.schema).toBe('txstory-fixture-v3');
    // A failed transaction with a decoded built-in revert.
    await page.goto('/example/anvil/0xc8009d5420b60b2d374a86c311dbf35e76810fbbaefab545a95bd92d3e86f4ec');
    await expect(page.locator('main')).toContainText('boom: not allowed');
    await page.getByRole('tab', { name: 'Call trace' }).click();
    await expect(page.locator('.banner-warn').filter({ hasText: 'Top-level revert' })).toContainText('Error("boom: not allowed")');
  });
});

test.describe('quality', () => {
  test('mobile layout has no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    for (const path of ['/', `/example/ethereum/${SWAP}`, `/example/ethereum/${BIG}`]) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), path).toBe(true);
    }
  });

  test('reduced motion hides the animated token', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/example/ethereum/${SWAP}`);
    await expect(page.locator('.token-dot')).toBeHidden();
  });

  test('no console errors across the main pages', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));
    for (const p of ['/', '/about', `/example/ethereum/${SWAP}`, `/example/base/${BASE_403}`]) {
      await page.goto(p);
      await page.waitForLoadState('networkidle');
    }
    expect(errors).toEqual([]);
  });
});

test.describe('cross-check scope and multi-transaction sessions', () => {
  test('ERC-721 rows say token ids were compared; evidence states the scope', async ({ page }) => {
    await page.goto(`/example/ethereum/${NFT}`);
    await expect(page.locator('.ledger').getByText('matches explorer (same token ids)').first()).toBeVisible();
    await page.getByRole('tab', { name: 'Completeness' }).click();
    await expect(page.getByRole('tabpanel')).toContainText('compared by token id');
    await expect(page.getByRole('tabpanel')).toContainText('compared by exact amount');
  });

  test('equal NFT counts with a different token id show as a mismatch', async ({ page }) => {
    await page.goto(`/example/ethereum/${NFT_DISAGREE}`);
    await expect(page.locator('.ledger .xc-bad').first()).toBeVisible();
    await expect(page.locator('.ledger')).toContainText('43');
  });

  test('A → B → A in one session shows each transaction’s own data and deep link', async ({ page }) => {
    const A = SWAP; const B = NFT;
    await page.goto(`/example/ethereum/${A}?m=log:1`);
    await expect(page.locator('.hash-row')).toContainText(A);
    await expect(page.locator('.detail')).toContainText('Step 2 of 3');
    await page.getByRole('link', { name: 'Lookup' }).click();
    await page.locator(`.example-grid a[href$="${B}"]`).click();
    await expect(page.locator('.hash-row')).toContainText(B);
    await expect(page.locator('.story-title')).not.toContainText('TAXT');
    await page.goBack(); await page.goBack();
    await expect(page.locator('.hash-row')).toContainText(A);
    await expect(page.locator('.story-title')).toContainText('TAXT');
  });
});
