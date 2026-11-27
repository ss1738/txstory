/**
 * The static developer site (npm run build:site), served by a plain file
 * server with no TxStory server behind it. Examples are rebuilt in the browser
 * from the shipped recordings; opened files never leave the page.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page, type Request } from '@playwright/test';
import { axe } from './helpers.js';

const DEVNET = '0xdce671e4526d6d277669b28b2a9108c3f291951eb893a8d716101d94a2640359';
const SWAP = '0xefb65ab1ab71b94063c0ee8e8c7bdde47b808c19f4e653ed931e3006f4983112';
const PENDING = '0xfbd6ef4b1d90c6e64d9359183593362d5e10d28f28a023c608b796e979c8494f';
const SWAP_FILE = `fixtures/synthetic/ethereum-${SWAP}.json`;
const DEVNET_FILE = `fixtures/devnet/anvil-${DEVNET}.json`;

/** Every request the page makes, so tests can assert where (and whether) data goes. */
function watchRequests(page: Page): Request[] {
  const seen: Request[] = [];
  page.on('request', (r) => seen.push(r));
  return seen;
}

const asFile = (name: string, text: string) => ({ name, mimeType: 'application/json', buffer: Buffer.from(text) });

test.describe('static site', () => {
  test('home explains the tool, has no lookup form, and lists labelled examples', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('actually');
    await expect(page.getByTestId('static-note')).toContainText('never asks for an RPC URL');
    await expect(page.locator('form.lookup')).toHaveCount(0);
    await expect(page.locator('.example-grid li')).toHaveCount(21);
    await expect(page.locator('.example-grid li').filter({ hasText: 'synthetic (not real data)' })).toHaveCount(15);
    await expect(page.locator('.example-grid li').filter({ hasText: 'local devnet' })).toHaveCount(6);
  });

  test('an example is rebuilt in the browser and reproduces its stored digests; only this origin is contacted', async ({ page, baseURL }) => {
    const requests = watchRequests(page);
    await page.goto(`/example/anvil/${DEVNET}`);
    const panel = page.getByTestId('reconstruction');
    await expect(panel).toContainText('Reproduced');
    await expect(panel).toContainText('local devnet');
    await expect(panel).toContainText('Evidence digest');
    await expect(panel).toContainText('rebuilt with TxStory');
    await expect(page.getByText('does not re-execute EVM code')).toBeVisible();
    await expect(page.locator('.story-title')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download recording (.json)' })).toHaveAttribute('href', `/recordings/anvil-${DEVNET}.json`);
    expect(requests.map((r) => new URL(r.url()).origin).filter((o) => o !== new URL(baseURL!).origin)).toEqual([]);
  });

  test('a pending example says no story was produced, with the reason', async ({ page }) => {
    await page.goto(`/example/ethereum/${PENDING}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('No story from this recording');
    await expect(page.getByTestId('reconstruction')).toContainText('No story produced');
    await expect(page.getByTestId('reconstruction')).toContainText('pending');
  });

  test('a missing example and a live link get clear, recoverable pages', async ({ page }) => {
    await page.goto(`/example/ethereum/0x${'12'.repeat(32)}`);
    await expect(page.getByRole('alert')).toContainText('not on this site');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await page.goto(`/tx/base/${SWAP}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Live lookups run on your own machine');
    await expect(page.locator('pre')).toContainText(`explain base ${SWAP}`);
  });
});

test.describe('open a recording (static site)', () => {
  test('a local file is rebuilt without sending it anywhere', async ({ page, baseURL }) => {
    await page.goto('/open');
    await expect(page.getByTestId('privacy-note')).toContainText('not uploaded');
    // Load the engine chunk first, so every request after choosing the file is visible.
    const requests = watchRequests(page);
    await page.setInputFiles('#recording-file', asFile('swap.json', readFileSync(SWAP_FILE, 'utf8')));
    const panel = page.getByTestId('reconstruction');
    await expect(panel).toContainText('Reproduced');
    await expect(panel).toContainText('File: swap.json');
    await expect(panel).toContainText('synthetic');
    const origin = new URL(baseURL!).origin;
    // At most the on-demand engine script; never a POST, never the recordings path, never another host.
    for (const r of requests) {
      expect(new URL(r.url()).origin).toBe(origin);
      expect(r.method()).toBe('GET');
      expect(new URL(r.url()).pathname).toMatch(/^\/assets\/.+\.js$/);
    }
    await expect(page.getByRole('button', { name: 'Copy link' })).toHaveCount(0);
  });

  test('an edited recording is reported as different, and says why differences cannot be itemised', async ({ page }) => {
    const rec = JSON.parse(readFileSync(SWAP_FILE, 'utf8'));
    const key = Object.keys(rec.exchanges).find((k) => rec.exchanges[k].method === 'eth_getTransactionReceipt')!;
    const receipt = JSON.parse(rec.exchanges[key].text);
    receipt.result.gasUsed = '0x' + (BigInt(receipt.result.gasUsed) + 1n).toString(16);
    rec.exchanges[key].text = JSON.stringify(receipt);
    await page.goto('/open');
    await page.setInputFiles('#recording-file', asFile('edited.json', JSON.stringify(rec)));
    const panel = page.getByTestId('reconstruction');
    await expect(panel).toContainText('Differs from the recording');
    await expect(panel).toContainText('Evidence digest');
    await expect(panel).toContainText('different');
    await expect(panel).toContainText('does not embed its original story');
  });

  test('a recording with missing responses lists them instead of fetching', async ({ page, baseURL }) => {
    const rec = JSON.parse(readFileSync(SWAP_FILE, 'utf8'));
    for (const k of Object.keys(rec.exchanges)) if (rec.exchanges[k].kind === 'explorer') delete rec.exchanges[k];
    rec.endpoints.explorerApi = 'https://example.invalid'; // an embedded URL is data, never fetched
    await page.goto('/open');
    const requests = watchRequests(page);
    await page.setInputFiles('#recording-file', asFile('partial.json', JSON.stringify(rec)));
    await expect(page.getByTestId('reconstruction')).toContainText('Not in the recording');
    expect(requests.filter((r) => new URL(r.url()).origin !== new URL(baseURL!).origin)).toEqual([]);
  });

  test('malformed, empty and unsupported files get a specific error and the page stays usable', async ({ page }) => {
    await page.goto('/open');
    await page.setInputFiles('#recording-file', asFile('broken.json', '{"schema":'));
    await expect(page.getByTestId('open-error')).toContainText('not valid JSON');
    await page.setInputFiles('#recording-file', asFile('empty.json', ''));
    await expect(page.getByTestId('open-error')).toContainText('empty');
    await page.setInputFiles('#recording-file', asFile('future.json', JSON.stringify({ ...JSON.parse(readFileSync(SWAP_FILE, 'utf8')), schema: 'txstory-fixture-v9' })));
    await expect(page.getByTestId('open-error')).toContainText('unknown schema');
    await page.setInputFiles('#recording-file', asFile('devnet.json', readFileSync(DEVNET_FILE, 'utf8')));
    await expect(page.getByTestId('reconstruction')).toContainText('Reproduced');
  });

  test('the file chooser is keyboard reachable', async ({ page }) => {
    await page.goto('/open');
    const input = page.locator('#recording-file');
    for (let i = 0; i < 12 && !(await input.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
    await expect(input).toBeFocused();
  });
});

test.describe('get started and site quality', () => {
  test('get started shows install, CLI, API, library and extension commands, and project links', async ({ page }) => {
    await page.goto('/start');
    for (const id of ['install', 'try', 'browser', 'live', 'record', 'api', 'library', 'extend']) await expect(page.locator(`#${id} pre`)).toBeVisible();
    await expect(page.locator('#install pre')).toContainText('git clone https://github.com/ss1738/txstory.git');
    await expect(page.getByRole('link', { name: 'Security reports' })).toHaveAttribute('href', /SECURITY\.md$/);
  });

  test('deep links load directly (static host fallback)', async ({ page }) => {
    for (const path of ['/start', '/open', '/about', `/example/ethereum/${SWAP}`]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
  });

  test('mobile layouts have no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    for (const path of ['/', '/start', '/open', `/example/ethereum/${SWAP}`]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      if (path.startsWith('/example')) await expect(page.getByTestId('reconstruction')).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });

  test('reduced motion disables animation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/open');
    const duration = await page.evaluate(() => {
      const el = document.createElement('span'); el.className = 'spinner'; document.body.append(el);
      return getComputedStyle(el).animationDuration;
    });
    expect(['0.001ms', '1e-06s', '0s']).toContain(duration);
  });

  test('no console errors across the site', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));
    for (const path of ['/', '/start', '/open', '/about', `/example/anvil/${DEVNET}`]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
    await expect(page.getByTestId('reconstruction')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('static site accessibility', () => {
  test.use({ bypassCSP: true });
  test('no serious accessibility violations (axe)', async ({ page }) => {
    for (const path of ['/', '/start', '/open', `/example/anvil/${DEVNET}`]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      if (path.startsWith('/example')) await expect(page.getByTestId('reconstruction')).toBeVisible();
      expect(await axe(page), path).toEqual([]);
    }
  });
});

test.describe('decode with your ABI (static site)', () => {
  const CUSTOM_ERROR = '0x27dbc58bd2861be2ea7264fd2d03aa97510ebc7ff3e00ab59a0bb114cbbe4aab';
  test('an ABI file decodes a custom error that the recording alone cannot, and the report says why the output changed', async ({ page, baseURL }) => {
    await page.goto(`/example/anvil/${CUSTOM_ERROR}`);
    const panel = page.getByTestId('reconstruction');
    await expect(panel).toContainText('Reproduced');
    await expect(page.locator('.interps')).toContainText('unknown error selector 0xcf479181');
    const requests = watchRequests(page);
    await page.setInputFiles('#abi-files', asFile('Demo.abi.json', readFileSync('fixtures/devnet/Demo.abi.json', 'utf8')));
    await expect(page.getByTestId('abi-control')).toContainText('Decoded with your ABIs (not part of the recording): Demo.abi.json');
    await expect(page.locator('.interps')).toContainText('InsufficientBalance(available="1000000000000000000", required="5")');
    await expect(panel).toContainText('decodes with ABIs you supplied (Demo.abi.json)');
    expect(requests.filter((r) => new URL(r.url()).origin !== new URL(baseURL!).origin || r.method() !== 'GET')).toEqual([]);
    await page.getByRole('button', { name: 'Rebuild without them' }).click();
    await expect(panel).toContainText('Reproduced');
    await expect(page.locator('.interps')).toContainText('unknown error selector 0xcf479181');
  });

  test('an invalid ABI file is reported and the story stays as it was', async ({ page }) => {
    await page.goto(`/example/anvil/${CUSTOM_ERROR}`);
    await expect(page.getByTestId('reconstruction')).toContainText('Reproduced');
    await page.setInputFiles('#abi-files', asFile('bad.json', '{"not": "an abi"}'));
    await expect(page.getByTestId('abi-error')).toContainText('bad.json');
    await expect(page.getByTestId('reconstruction')).toContainText('Reproduced');
  });
});

test.describe('switching between recordings of one network key', () => {
  test('each opened recording is shown with its own network definition, in any order', async ({ page }) => {
    const a = readFileSync(DEVNET_FILE, 'utf8');
    const bJson = JSON.parse(a);
    bJson.network = { ...bJson.network, name: 'Other devnet', nativeSymbol: 'XYZ', chainId: 4242 };
    const b = JSON.stringify(bJson);
    const strip = page.locator('.story-strip .eyebrow');
    const panel = page.getByTestId('reconstruction');
    const open = async (name: string, text: string) => {
      await page.goto('/open');
      await page.setInputFiles('#recording-file', asFile(name, text));
      await expect(panel).toContainText(`File: ${name}`);
    };
    await open('a.json', a);
    await expect(strip).toHaveText('Anvil devnet');
    await expect(panel).toContainText('Reproduced');
    await open('b.json', b);
    await expect(strip).toHaveText('Other devnet');
    await expect(page.locator('#main')).toContainText('XYZ');
    await expect(panel).toContainText('Differs from the recording');
    await open('a-again.json', a);
    await expect(strip).toHaveText('Anvil devnet');
    await expect(panel).toContainText('Reproduced');
    // A shipped example after the conflicting file, without reloading the app.
    await open('b2.json', b);
    await page.getByRole('link', { name: 'Examples' }).click();
    await page.locator('.example-grid a').filter({ hasText: 'payAndTry' }).click();
    await expect(strip).toHaveText('Anvil devnet');
    await expect(panel).toContainText('Reproduced');
  });
});
