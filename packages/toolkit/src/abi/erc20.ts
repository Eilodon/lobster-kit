import { parseAbi } from 'viem';

export const ERC20_APPROVE_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
]);

export const ERC20_ALLOWANCE_ABI = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
]);

export const ERC20_BALANCE_OF_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
]);

export const ERC20_DECIMALS_ABI = parseAbi([
  'function decimals() view returns (uint8)',
]);
