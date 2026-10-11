// Fill these in after deploying (the deploy script prints both addresses and the block).
// They can also be overridden per link with ?doorstep=0x...&escrow=0x...&chain=5042
export const CONFIG = {
  chainId: 5042,
  rpcUrl: 'https://rpc.mainnet.arc.io',
  explorer: 'https://explorer.arc.io',
  doorstep: '0xd614A7B602E1417F258A834465AE01F47891e080',
  escrow: '0x3da5F9d36d1AE8769A9460a7788a21c8041C7bB3',
  deployBlock: 25488972, // first block to scan for events
};

export const TESTNET = {
  chainId: 5042002,
  rpcUrl: 'https://rpc.testnet.arc.io',
  explorer: 'https://explorer.testnet.arc.io',
};
