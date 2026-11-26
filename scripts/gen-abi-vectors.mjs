#!/usr/bin/env node
/**
 * Generate ABI test vectors with Foundry's `cast` as an INDEPENDENT encoder.
 * TxStory's decoder must recover the original arguments from cast's bytes.
 *   node scripts/gen-abi-vectors.mjs > tests/vectors/abi-cast.json
 */
import { execFileSync } from 'node:child_process';
const cast = (...a) => execFileSync('cast', a, { encoding: 'utf8' }).trim();
const A = '0x00000000000000000000000000000000deadbeef';
const B = '0xffffffffffffffffffffffffffffffffffffffff';
const cases = [
  { sig: 'transfer(address,uint256)', args: [A, '1000000000000000000000000000000'], expect: [A, '1000000000000000000000000000000'] },
  { sig: 'mixed(int8,int256,bool,bytes3,bytes,string)', args: ['-5', '-57896044618658097711785492504343953926634992332820282019728792003956564819968', 'true', '0x010203', '0xdeadbeef00', 'héllo ✓'],
    expect: ['-5', '-57896044618658097711785492504343953926634992332820282019728792003956564819968', true, '0x010203', '0xdeadbeef00', 'héllo ✓'] },
  { sig: 'arrays(uint256[],address[2],string[])', args: ['[1,2,3]', `[${A},${B}]`, '["a","bc"]'], expect: [['1', '2', '3'], [A, B], ['a', 'bc']] },
  { sig: 'nested((uint8,bytes32,(string,uint256[]))[])', args: ['[(7,0x0000000000000000000000000000000000000000000000000000000000000001,("x",[9,10])),(255,0xff00000000000000000000000000000000000000000000000000000000000000,("",[]))]'],
    expect: [[{ 0: '7', 1: '0x0000000000000000000000000000000000000000000000000000000000000001', 2: { 0: 'x', 1: ['9', '10'] } }, { 0: '255', 1: '0xff00000000000000000000000000000000000000000000000000000000000000', 2: { 0: '', 1: [] } }]] },
  { sig: 'empties(bytes,string,uint256[],uint16)', args: ['0x', '""', '[]', '65535'], expect: ['0x', '', [], '65535'] },
  { sig: 'fixedNested(uint256[2][3],bool)', args: ['[[1,2],[3,4],[5,6]]', 'false'], expect: [[['1', '2'], ['3', '4'], ['5', '6']], false] },
  { sig: 'InsufficientBalance(uint256,uint256)', kind: 'error', args: ['100', '250'], expect: ['100', '250'] },
  { sig: 'Error(string)', kind: 'error', args: ['insufficient allowance'], expect: ['insufficient allowance'] },
  { sig: 'Panic(uint256)', kind: 'error', args: ['17'], expect: ['17'] },
  // Known 4-byte collision: burn(uint256) and collate_propagate_storage(bytes16) share 0x42966c68.
  { sig: 'burn(uint256)', args: ['1'], expect: ['1'] },
  { sig: 'burn(uint256)', args: ['57896044618658097711785492504343953926634992332820282019728792003956564819968'], expect: ['57896044618658097711785492504343953926634992332820282019728792003956564819968'] },
];
const out = { generatedBy: 'scripts/gen-abi-vectors.mjs', encoder: cast('--version').split('\n')[0], calldata: [], events: [] };
for (const c of cases) {
  const data = cast('calldata', c.sig, ...c.args);
  out.calldata.push({ kind: c.kind ?? 'function', signature: c.sig, selector: cast('sig', c.sig), data, expect: c.expect });
}
// Event: Swapped(address indexed who, uint256 indexed id, string note, int24 tick): topics via cast, data via abi-encode.
const evSig = 'Swapped(address,uint256,string,int24)';
out.events.push({
  signature: evSig, abi: 'event Swapped(address indexed who, uint256 indexed id, string note, int24 tick)',
  topics: [cast('keccak', evSig), cast('abi-encode', 'f(address)', A), cast('abi-encode', 'f(uint256)', '42')],
  data: cast('abi-encode', 'f(string,int24)', 'gm', '-887272'),
  expect: { who: A, id: '42', note: 'gm', tick: '-887272' },
});
// Seaport OrderFulfilled with nested tuple arrays (used by the synthetic Seaport sale and the decoder-module test).
const SELLER = '0x5e11e75e11e75e11e75e11e75e11e75e11e75e11';
const BUYER = '0xb0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0';
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const NFT1155 = '0x1155115511551155115511551155115511551155';
const FEES = '0xfee0fee0fee0fee0fee0fee0fee0fee0fee0fee0';
const ORDER = '0x' + '11'.repeat(32);
const ZONE = '0x0000000000000000000000000000000000000000';
out.events.push({
  signature: 'OrderFulfilled(bytes32,address,address,address,(uint8,address,uint256,uint256)[],(uint8,address,uint256,uint256,address)[])',
  abi: 'event OrderFulfilled(bytes32 orderHash, address indexed offerer, address indexed zone, address recipient, (uint8 itemType, address token, uint256 identifier, uint256 amount)[] offer, (uint8 itemType, address token, uint256 identifier, uint256 amount, address recipient)[] consideration)',
  topics: [
    cast('keccak', 'OrderFulfilled(bytes32,address,address,address,(uint8,address,uint256,uint256)[],(uint8,address,uint256,uint256,address)[])'),
    cast('abi-encode', 'f(address)', SELLER), cast('abi-encode', 'f(address)', ZONE),
  ],
  data: cast('abi-encode', 'f(bytes32,address,(uint8,address,uint256,uint256)[],(uint8,address,uint256,uint256,address)[])',
    ORDER, BUYER, `[(1,${WETH},0,3000000000000000)]`, `[(3,${NFT1155},10933,1,${SELLER}),(1,${WETH},0,75000000000000,${FEES})]`),
  expect: { orderHash: ORDER, offerer: SELLER, zone: ZONE, recipient: BUYER },
});
process.stdout.write(JSON.stringify(out, null, 1) + '\n');
