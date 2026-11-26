/** Uniswap-style pool events (V2 pairs, V3 pools, V4 PoolManager). Many forks emit the same signatures. */
import type { DecoderModule } from './types.js';

export const uniswap: DecoderModule = {
  id: 'uniswap', name: 'Uniswap-style pools', description: 'Swap/Sync/Mint/Burn events of Uniswap V2/V3/V4 and forks with identical signatures.',
  abi: [
    'event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)',
    'event Sync(uint112 reserve0, uint112 reserve1)',
    'event Mint(address indexed sender, uint256 amount0, uint256 amount1)',
    'event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to)',
    'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
    'event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)',
  ],
};
