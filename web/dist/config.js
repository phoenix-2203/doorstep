// Doorstep deployments the app talks to. Links can override with ?doorstep=0x...&chain=...&rpc=...
export const CONFIG = {
  chainId: 5042,
  rpcUrl: 'https://rpc.mainnet.arc.io',
  explorer: 'https://explorer.arc.io',
  // Current Doorstep (v2 adds cancel). Until v2 is deployed this points at v1.
  doorstep: '0xd614A7B602E1417F258A834465AE01F47891e080',
  deployBlock: 25488972, // first block to scan for events
  escrow: '0x3da5F9d36d1AE8769A9460a7788a21c8041C7bB3',
  // Older deployments. Links created before `deployBlock` without ?doorstep= belong to v1.
  legacy: [{ version: 1, doorstep: '0xd614A7B602E1417F258A834465AE01F47891e080', deployBlock: 25488972 }],
};

export const TESTNET = {
  chainId: 5042002,
  rpcUrl: 'https://rpc.testnet.arc.io',
  explorer: 'https://explorer.testnet.arc.io',
};
