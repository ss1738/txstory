/** Token standards and WETH. Balance movements for these are derived in events.ts; this module adds display decoding. */
import type { DecoderModule } from './types.js';

export const erc20: DecoderModule = {
  id: 'erc20', name: 'ERC-20', description: 'Fungible token events and the common calls.',
  abi: [
    'event Transfer(address indexed from, address indexed to, uint256 value)',
    'event Approval(address indexed owner, address indexed spender, uint256 value)',
    'function transfer(address to, uint256 value)',
    'function transferFrom(address from, address to, uint256 value)',
    'function approve(address spender, uint256 value)',
  ],
};

export const erc721: DecoderModule = {
  id: 'erc721', name: 'ERC-721', description: 'Non-fungible token events and transfers.',
  abi: [
    'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
    'event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId)',
    'event ApprovalForAll(address indexed owner, address indexed operator, bool approved)',
    'function safeTransferFrom(address from, address to, uint256 tokenId)',
    'function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)',
    'function setApprovalForAll(address operator, bool approved)',
  ],
};

export const erc1155: DecoderModule = {
  id: 'erc1155', name: 'ERC-1155', description: 'Multi-token events and transfers.',
  abi: [
    'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)',
    'event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)',
    'event URI(string value, uint256 indexed id)',
    'function safeTransferFrom(address from, address to, uint256 id, uint256 value, bytes data)',
    'function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] values, bytes data)',
  ],
};

export const weth: DecoderModule = {
  id: 'weth', name: 'WETH-style wrapped native', description: 'Deposit/Withdrawal of wrapped native tokens.',
  abi: [
    'event Deposit(address indexed dst, uint256 wad)',
    'event Withdrawal(address indexed src, uint256 wad)',
    'function deposit()',
    'function withdraw(uint256 wad)',
  ],
};
