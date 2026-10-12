// Doorstep deployments the app talks to. Links can override with ?doorstep=0x...&chain=...&rpc=...
export const CONFIG = {
  chainId: 5042,
  rpcUrl: 'https://rpc.mainnet.arc.io',
  explorer: 'https://explorer.arc.io',
  // Current Doorstep: v2 (adds cancel), deployed in tx 0x32ad069f…4a27.
  doorstep: '0x56BD0FEfdaAF9d053a74107E6dDb9de19D306229',
  deployBlock: 25509432, // first block to scan for events
  escrow: '0x3da5F9d36d1AE8769A9460a7788a21c8041C7bB3',
  // Older deployments. Links created before `deployBlock` without ?doorstep= belong to v1.
  legacy: [{ version: 1, doorstep: '0xd614A7B602E1417F258A834465AE01F47891e080', deployBlock: 25488972 }],
};

// Public addresses of the site and API (update when the domain changes).
export const SITE = {
  url: 'https://phoenix-2203.github.io/doorstep/',
  app: 'https://phoenix-2203.github.io/doorstep/app/',
  api: 'https://api.104-251-218-80.sslip.io',
  repo: 'https://github.com/phoenix-2203/doorstep',
};

export const TESTNET = {
  chainId: 5042002,
  rpcUrl: 'https://rpc.testnet.arc.io',
  explorer: 'https://explorer.testnet.arc.io',
};
