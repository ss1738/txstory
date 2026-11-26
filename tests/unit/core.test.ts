import { describe, expect, it } from 'vitest';
import { formatCompact, formatUnits, parseDecimals, toBigInt } from '../../src/core/amounts.js';
import { checksumAddress, dataWords, keccakHex, wordToAddress, wordToInt } from '../../src/core/hex.js';
import { cleanUntrusted } from '../../src/core/text.js';
import { decodeLog, decodeTransferBatch, TOPICS } from '../../src/core/events.js';
import { computeLedger } from '../../src/core/ledger.js';
import { crossCheck } from '../../src/core/crosscheck.js';
import type { Asset, Movement } from '../../src/core/types.js';
import type { ExplorerInput } from '../../src/core/inputs.js';

const pad = (hex: string) => hex.replace(/^0x/, '').padStart(64, '0');
const A1 = '0x1111111111111111111111111111111111111111';
const A2 = '0x2222222222222222222222222222222222222222';
const TOKEN = '0x3333333333333333333333333333333333333333';

describe('amounts: exact precision', () => {
  it('formats values far beyond Number precision exactly', () => {
    expect(formatUnits('13022183624750241637229919', 18)).toBe('13022183.624750241637229919');
    expect(formatUnits(2n ** 256n - 1n, 18, { group: true })).toBe('115,792,089,237,316,195,423,570,985,008,687,907,853,269,984,665,640,564,039,457.584007913129639935');
    expect(formatUnits('1', 18)).toBe('0.000000000000000001');
    expect(formatUnits('-1500000', 6)).toBe('-1.5');
    expect(formatUnits('0', 0)).toBe('0');
    expect(formatUnits('123', 0)).toBe('123');
  });
  it('rejects malformed inputs instead of guessing', () => {
    expect(() => formatUnits('1.5', 18)).toThrow();
    expect(() => formatUnits('1', 256)).toThrow();
    expect(() => toBigInt('12abc')).toThrow();
    expect(() => toBigInt(2 ** 60)).toThrow(); // unsafe JS number
  });
  it('parses hex and decimal quantities', () => {
    expect(toBigInt('0x10')).toBe(16n);
    expect(toBigInt('0x')).toBe(0n);
    expect(toBigInt('42')).toBe(42n);
  });
  it('compact display never invents precision and keeps sign', () => {
    expect(formatCompact('68300597997526149', 18)).toBe('0.0683005…');
    expect(formatCompact('-13022183624750241637229919', 18)).toBe('−13,022,183…');
    expect(formatCompact('235000160032', 18)).toBe('0.000000235…');
    expect(formatCompact('100', 18)).toBe('<0.000000001');
    expect(formatCompact('1000000', 6)).toBe('1');
    expect(formatCompact('0', 18)).toBe('0');
  });
  it('parses explorer decimals defensively', () => {
    expect(parseDecimals('18')).toBe(18);
    expect(parseDecimals(6)).toBe(6);
    expect(parseDecimals('256')).toBeNull();
    expect(parseDecimals('1e3')).toBeNull();
    expect(parseDecimals(null)).toBeNull();
  });
});

describe('hex', () => {
  it('matches published EIP-55 checksum vectors (independent reference)', () => {
    for (const v of ['0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359', '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB', '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb']) {
      expect(checksumAddress(v.toLowerCase())).toBe(v);
    }
  });
  it('derives the well-known ERC-20 Transfer topic', () => {
    expect(keccakHex('Transfer(address,address,uint256)')).toBe('0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef');
    expect(TOPICS.Transfer).toBe('0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef');
  });
  it('rejects non-canonical address words', () => {
    expect(wordToAddress('0x' + '00'.repeat(12) + '11'.repeat(20))).toBe(A1);
    expect(wordToAddress('0x' + '01' + '00'.repeat(11) + '11'.repeat(20))).toBeNull();
    expect(dataWords('0x123')).toBeNull();
  });
  it('interprets signed words', () => {
    expect(wordToInt('f'.repeat(64))).toBe(-1n);
    expect(wordToInt(pad('0x05'))).toBe(5n);
  });
});

describe('untrusted text', () => {
  it('strips bidi overrides and zero-width characters and reports it', () => {
    const c = cleanUntrusted('US‮DC​', 64)!;
    expect(c.text).toBe('USDC');
    expect(c.altered).toBe(true);
  });
  it('truncates long strings and ignores non-strings', () => {
    expect(cleanUntrusted('x'.repeat(100), 10)!.text).toHaveLength(10);
    expect(cleanUntrusted(42)).toBeNull();
    expect(cleanUntrusted('   ')).toBeNull();
  });
});

describe('event decoding', () => {
  const t = (addr: string) => '0x' + pad(addr);
  it('decodes ERC-20 vs ERC-721 Transfer by layout', () => {
    const erc20 = decodeLog({ address: TOKEN, topics: [TOPICS.Transfer, t(A1), t(A2)], data: '0x' + pad('0x0de0b6b3a7640000'), logIndex: 7 });
    expect(erc20.event).toMatchObject({ kind: 'transfer', standard: 'erc20', from: A1, to: A2, amount: '1000000000000000000' });
    const erc721 = decodeLog({ address: TOKEN, topics: [TOPICS.Transfer, t(A1), t(A2), '0x' + pad('0x2a')], data: '0x', logIndex: 8 });
    expect(erc721.event).toMatchObject({ kind: 'transfer', standard: 'erc721', tokenId: '42' });
  });
  it('refuses non-standard Transfer layouts instead of guessing', () => {
    const r = decodeLog({ address: TOKEN, topics: [TOPICS.Transfer], data: '0x' + pad(A1) + pad(A2) + pad('0x1'), logIndex: 1 });
    expect(r.event).toBeNull();
    expect(r.problem).toMatch(/non-standard/);
  });
  it('decodes ERC-1155 TransferBatch arrays and rejects malformed offsets', () => {
    const data = '0x' + pad('0x40') + pad('0xa0') + pad('0x2') + pad('0x1') + pad('0x2') + pad('0x2') + pad('0x5') + pad('0x6');
    const ok = decodeTransferBatch({ address: TOKEN, topics: [TOPICS.TransferBatch, t(A1), t(A1), t(A2)], data, logIndex: 3 });
    expect(Array.isArray(ok) && ok.map((e) => e.kind === 'transfer' && e.standard === 'erc1155' ? [e.tokenId, e.amount] : null)).toEqual([['1', '5'], ['2', '6']]);
    const bad = decodeTransferBatch({ address: TOKEN, topics: [TOPICS.TransferBatch, t(A1), t(A1), t(A2)], data: '0x' + pad('0xffffffff') + pad('0xa0') + pad('0x0') + pad('0x0'), logIndex: 3 });
    expect(Array.isArray(bad)).toBe(false);
  });
});

const ASSETS: Record<string, Asset> = {
  native: { key: 'native', kind: 'native', contract: null, tokenId: null, symbol: 'ETH', name: null, decimals: 18, metadataSource: 'chain-config' },
  [TOKEN]: { key: TOKEN, kind: 'erc20', contract: TOKEN as Asset['contract'], tokenId: null, symbol: 'TKN', name: null, decimals: 6, metadataSource: 'explorer' },
};
const mv = (id: string, from: string | null, to: string | null, amount: string, assetKey = TOKEN, extra: Partial<Movement> = {}): Movement => ({
  id, kind: 'token-transfer', sequence: 0, from: from as Movement['from'], to: to as Movement['to'], assetKey, amount, provenance: 'derived', sourceIds: [], label: '', ...extra,
});

describe('ledger', () => {
  it('nets movements exactly and drops zero rows', () => {
    const ledger = computeLedger([mv('a', A1, A2, '100'), mv('b', A2, A1, '100'), mv('c', A1, null, '5'), mv('d', null, A2, '7')], ASSETS);
    expect(ledger).toEqual([
      expect.objectContaining({ address: A1, assetKey: TOKEN, delta: '-5' }),
      expect.objectContaining({ address: A2, assetKey: TOKEN, delta: '7' }),
    ]);
  });
  it('conserves supply: sum of deltas equals mints minus burns', () => {
    const moves = [mv('a', A1, A2, '123456789012345678901234567890'), mv('b', null, A1, '10'), mv('c', A2, null, '3')];
    const sum = computeLedger(moves, ASSETS).reduce((s, r) => s + BigInt(r.delta), 0n);
    expect(sum).toBe(10n - 3n);
  });
});

describe('cross-check', () => {
  const explorer = (items: ExplorerInput['stateChanges']['items']): ExplorerInput => ({
    available: true, txSourceId: 'x', method: null, decodedInput: null, revertReason: null, addresses: {},
    internal: { status: 'complete', items: [], sourceIds: [] }, stateChanges: { status: 'complete', items, sourceIds: [] },
    tokenTransfers: { status: 'complete', items: [], sourceIds: [] }, logNames: {}, summaries: [], summarySourceId: null,
  });
  it('classifies match, mismatch, zero-address and net-zero rows', () => {
    const ledger = computeLedger([mv('a', A1, A2, '100')], ASSETS);
    const r = crossCheck(ledger, explorer([
      { address: A1 as never, isCoin: false, token: TOKEN as never, tokenType: 'ERC-20', tokenId: null, isMiner: false, change: { kind: 'amount', delta: '-100' } },
      { address: A2 as never, isCoin: false, token: TOKEN as never, tokenType: 'ERC-20', tokenId: null, isMiner: false, change: { kind: 'amount', delta: '99' } },
      { address: '0x0000000000000000000000000000000000000000' as never, isCoin: false, token: TOKEN as never, tokenType: 'ERC-20', tokenId: null, isMiner: false, change: { kind: 'amount', delta: '5' } },
      { address: '0x4444444444444444444444444444444444444444' as never, isCoin: false, token: TOKEN as never, tokenType: 'ERC-20', tokenId: null, isMiner: false, change: { kind: 'amount', delta: '0' } },
    ]), true);
    expect(r.summary).toEqual({ match: 2, mismatch: 1, onlyTxStory: 0, onlyExplorer: 0, notComparable: 1 });
  });
  it('reports unavailability rather than agreement when the explorer is absent', () => {
    const r = crossCheck([], null, true);
    expect(r.available).toBe(false);
    expect(r.rows).toEqual([]);
  });
});
