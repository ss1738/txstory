/**
 * Seaport (NFT marketplace protocol): the worked example of a decoder module
 * with interpretations. See docs/extending.md.
 *
 * What it claims: that a contract EMITTED OrderFulfilled with these fields.
 * What it does not claim: that the emitter is a genuine Seaport deployment, or
 * that the listed items moved (actual movements are in the balance table).
 */
import type { AbiValue } from '../abi.js';
import type { DecoderModule, ModuleInterpretation } from './types.js';
import { param } from './types.js';

const ITEM_TYPES = ['native', 'ERC-20', 'ERC-721', 'ERC-1155', 'ERC-721 (criteria)', 'ERC-1155 (criteria)'];

function describeItem(item: AbiValue, symbolFor: (token: string) => string | null): string {
  const f = item as Record<string, AbiValue>;
  const type = ITEM_TYPES[Number(f.itemType ?? f['0'])] ?? `item type ${String(f.itemType ?? f['0'])}`;
  const token = String(f.token ?? f['1']);
  const id = String(f.identifier ?? f['2']);
  const amount = String(f.amount ?? f['3']);
  const sym = symbolFor(token);
  const tokenText = type === 'native' ? '' : ` ${sym ?? token}`;
  const idText = type.startsWith('ERC-721') || type.startsWith('ERC-1155') ? ` #${id}` : '';
  return `${amount} × ${type}${tokenText}${idText} (raw amount)`;
}

export const seaport: DecoderModule = {
  id: 'seaport', name: 'Seaport', description: 'OrderFulfilled / OrdersMatched events of the Seaport marketplace protocol.',
  abi: [
    'event OrderFulfilled(bytes32 orderHash, address indexed offerer, address indexed zone, address recipient, (uint8 itemType, address token, uint256 identifier, uint256 amount)[] offer, (uint8 itemType, address token, uint256 identifier, uint256 amount, address recipient)[] consideration)',
    'event OrdersMatched(bytes32[] orderHashes)',
    'event OrderCancelled(bytes32 orderHash, address indexed offerer, address indexed zone)',
  ],
  interpret: ({ story, logs }) => {
    const out: ModuleInterpretation[] = [];
    const symbolFor = (token: string) => story.assets[token.toLowerCase()]?.symbol ?? null;
    for (const l of logs) {
      if (l.match?.signature.startsWith('OrderFulfilled(') !== true) continue;
      const offer = (param(l.match, 'offer', 4) as AbiValue[]) ?? [];
      const consideration = (param(l.match, 'consideration', 5) as AbiValue[]) ?? [];
      out.push({
        id: `fulfilled:${l.logIndex}`, confidence: 'decoded',
        headline: `Seaport order fulfilled: ${offer.length} offered item(s) for ${consideration.length} consideration item(s)`,
        detail: `Offerer ${String(param(l.match, 'offerer', 1))} offered ${offer.map((i) => describeItem(i, symbolFor)).join('; ') || 'nothing'}. `
          + `Consideration: ${consideration.map((i) => describeItem(i, symbolFor)).join('; ') || 'nothing'}. Recipient ${String(param(l.match, 'recipient', 3))}.`,
        evidence: [`log:${l.logIndex}`],
        caveats: [
          `Decoded from an event emitted by ${l.contract}. Any contract can emit this event signature; check the address against Seaport's published deployments.`,
          'These are the order terms the event reports. Actual balance changes are in the table below.',
        ],
      });
    }
    return out;
  },
};
