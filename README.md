# Doorstep

**Deposit addresses that fund any Arc contract on arrival.** A sender presses Send in any wallet, withdraws from an exchange, or bridges with CCTP. Doorstep deposits the USDC into the contract you chose, credited to the person you chose, or sends it back if that isn't possible.

Live on Arc mainnet (chain 5042): Doorstep [`0xd614A7B602E1417F258A834465AE01F47891e080`](https://explorer.arc.io/address/0xd614A7B602E1417F258A834465AE01F47891e080) · Demo escrow [`0x3da5F9d36d1AE8769A9460a7788a21c8041C7bB3`](https://explorer.arc.io/address/0x3da5F9d36d1AE8769A9460a7788a21c8041C7bB3) · App: https://phoenix-2203.github.io/doorstep/

## The problem

On Arc, USDC is both the native gas token and an ERC-20 at `0x3600…0000`, with one balance behind both. Wallets treat "Send USDC" as a native transfer. Most escrows and vaults have no payable `receive()` and pull deposits with `transferFrom`, so **a plain wallet send to them reverts**.

This happened on Arc mainnet on 2026-10-02: a Rabby send to an escrow failed, and the team fell back to funding it from a backend script ([BreadchainCoop/curacao-crypto-onramp-bot#48](https://github.com/BreadchainCoop/curacao-crypto-onramp-bot/issues/48)). Making the escrow payable was rejected because of the cross-chain audit risk.

The same wall blocks every route that can only deliver to an address:

- exchange withdrawals on the Arc network
- Circle's CCTP Forwarding Service, which mints to a recipient address
- Gateway spends to a recipient

None of them can call `deposit(amount, beneficiary)` for the user.

`DemoEscrow` in this repo is that ordinary escrow, and `test_plainWalletSendToEscrowReverts` shows the failure. Its `deposit(uint256 amount, address beneficiary)` has the same selector (`0x6e553f65`) and argument order as ERC-4626 `deposit(assets, receiver)`, so the same intent shape funds any ERC-4626 vault on Arc.

## How it works

```
intent = { target, callData, amountOffset, refundTo, minAmount6, maxKeeperFee6, expiry, ref }
depositAddress = CREATE2(Doorstep, salt = keccak256(abi.encode(intent)), DoorstepLander)
```

1. **Get an address, deploy nothing.** The address is a pure function of the intent, so the app computes it offline. Anyone can recompute it to check what it does before paying.
2. **Pay by any route.** Native send, ERC-20 transfer, exchange withdrawal and CCTP mint all land in the same native balance on Arc.
3. **Anyone calls `land(intent)`.** In one transaction, Doorstep:
    1. deploys an 8-byte `DoorstepLander` at the address, whose constructor self-destructs its balance into Doorstep;
    2. approves the target for exactly the deposit, minus the keeper fee, in 6-decimal units;
    3. writes that amount into `callData` at `amountOffset` and calls the target;
    4. revokes the approval;
    5. sends anything the target didn't take, plus sub-micro-USDC dust, to `refundTo`;
    6. repays the caller's gas from the deposit, capped by `maxKeeperFee6`.
4. **The address is reusable.** The lander is created and destroyed in the same transaction (EIP-6780), so the address has no code afterwards. It can receive again, even from exchanges that send with a fixed 21,000 gas limit.

If the intent has expired, or the target call reverts, the deposit **bounces** to `refundTo`. If less than `minAmount6` has arrived, `land` reverts and the funds wait at the address for a top-up.

## Why this is Arc-native

| Arc property | What Doorstep does with it |
| --- | --- |
| Gas is paid in USDC | The keeper is repaid in the asset it spent, by arithmetic: no oracle, no swap, no relayer float. |
| One USDC balance, two interfaces | A single sweep handles native sends and ERC-20 transfers alike. On other EVM chains, a deposit address must handle ETH and tokens separately and needs ETH for gas. |
| `SELFDESTRUCT` moves native USDC | The 8-byte lander is the whole sweep mechanism. |
| Deterministic, sub-second finality | Credit is final as soon as the landing is included. |
| 20 Gwei fee floor, about $0.001 per transfer | A landing costs a fraction of a cent, so even small deposits are worth landing. |

Arc's `Memo` and `Multicall3From` only accept EOA callers, and Doorstep is a contract. So the reference travels in Doorstep's own `Landed` event (`intentHash`, `ref`, `target` indexed).

## Trust model and limits

- **The payer trusts the intent author**, as with any invoice or payment link. The app shows the decoded intent (target, beneficiary, refund address, expiry) next to the QR code, and recomputes the address itself.
- **Doorstep holds nothing between transactions** and keeps no balances in storage. Each landing spends only the balance change it caused (`test_greedyTargetCannotTakeStrays`). Direct native sends to the factory revert.
- **`refundTo` must be an address the author controls**, never an exchange deposit address. Refunds go there.
- **Blocklist:** if `refundTo` or the target is blocklisted on Arc, `land` reverts and the funds stay at the deposit address (`test_blocklistedRefundToKeepsFundsAtAddress`).
- **No forced bounces:** a keeper picks its own gas limit, so it could try to starve the target call and make a good deposit bounce. If the target call fails by running out of the gas it was given, `land` reverts instead, and the funds stay put. A target that can never succeed is refunded after expiry, because that path never calls it (`test_outOfGasTargetNeverBounces`, `test_underGassedLandingCannotForceBounce`).
- **Keeper fee:** the keeper is paid the gas it actually used, at `min(tx.gasprice, 2 × basefee)`, never above the intent's cap and never above the deposit. Before the target call, Doorstep reserves an upper-bound fee so the credited amount is fixed in advance. After the call, it measures the real gas, including the 19,900-gas allowance refund the keeper never pays, and returns the unused reserve to `refundTo`. Measured on a local Arc Zero8 node, the fee is within +2–3% of the keeper's real cost on every path (`keeper/feecheck.mjs`).
- **Gas estimates:** at gas price 0 the fee is 0 and the fee transfer is skipped, so a plain `eth_estimateGas` comes out about 7k gas short. The keeper and app estimate with a real gas price and add headroom; do the same in any integration.
- **Unaudited.** Use small amounts.

## Repository

| Path | What it is |
| --- | --- |
| `src/Doorstep.sol` | Factory, lander, landing logic (about 340 lines, heavily commented) |
| `src/DemoEscrow.sol` | An ordinary non-payable escrow, the demo target |
| `test/Doorstep.t.sol` | Tests run under Arc semantics with Arc Foundry |
| `test/ArcGenesis.sol` | Arc's USDC and system contracts, generated from `circlefin/arc-node` genesis, etched only if missing |
| `script/Deploy.s.sol` | Deploys to Arc mainnet or testnet; refuses other chains |
| `scripts/demo-mainnet.sh` | Live mainnet demo with `arc-cast` and a keystore: problem, two landings at one address, a bounce, a withdrawal |
| `keeper/keeper.mjs` | Permissionless keeper: discovers `Announced` intents from logs (in spans under the RPC's 10,000-block cap), lands deposits |
| `keeper/e2e.mjs` | End-to-end rehearsal with real transactions (local node or testnet) |
| `keeper/feecheck.mjs` | Keeper fee versus actual gas cost for every landing |
| `keeper/vector.mjs` | The viem address derivation pinned by `test_addressMatchesViemVector` |
| `web/` | Static app: create an address, pay, watch it land |

## What has been verified

| Check | Where | Result |
| --- | --- | --- |
| 25 unit and fuzz tests under Arc execution rules (hardfork Zero8, the one mainnet runs) | `test/Doorstep.t.sol` with Arc Foundry | all pass |
| Real separate transactions on a local Arc node: wallet send to escrow reverts; native send lands; **same address reused in a later transaction**; ERC-20 transfer lands; expired intent bounces; factory ends empty | `keeper/e2e.mjs` against `arc-anvil --network arc --hardfork arc:zero8` | all pass |
| Keeper discovers an announced intent from logs and lands a deposit unattended | `keeper/keeper.mjs` | landed |
| Web app: create address, QR, live status, landed state, mobile layout | headless Chromium against the local node | works |
| Page and contract compute the same deposit address | `test_addressMatchesViemVector` | equal |
| The same 25 tests against live Arc mainnet state | `arc-forge test --fork-url https://rpc.mainnet.arc.io` | all pass |
| Live run on Arc mainnet: deploy, native send lands, ERC-20 transfer to the same address lands, expired intent bounces | `scripts/demo-mainnet.sh` | all pass, see [Mainnet proof](#mainnet-proof) |

Arc's USDC system contracts used in the tests are generated from `circlefin/arc-node`'s genesis. The USDC proxy and implementation bytecode are identical in the localdev and mainnet genesis files.

## Run it

Requires [Arc Foundry](https://github.com/circlefin/arc-foundry) (`arc-forge`, `arc-cast`, `arc-anvil`). Upstream Foundry runs tests under Ethereum rules, so it does **not** test Arc behavior.

```shell
# tests under Arc rules
FOUNDRY_PROFILE=arc arc-forge test -vv

# the same tests against live Arc mainnet state
FOUNDRY_PROFILE=arc arc-forge test --fork-url https://rpc.mainnet.arc.io -vv

# full rehearsal with real transactions on a local Arc node
arc-anvil --network arc --hardfork arc:zero8          # in another terminal
FOUNDRY_PROFILE=arc arc-forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --broadcast
cd keeper && npm install
RPC_URL=http://127.0.0.1:8545 DOORSTEP=<Doorstep> ESCROW=<DemoEscrow> \
  PAYER_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d \
  KEEPER_KEY=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a node e2e.mjs
```

(Those keys are Anvil's public development keys. Never use them on mainnet.)

Deploy (your key stays in your local encrypted keystore):

```shell
arc-cast wallet import doorstep-deployer --interactive
FOUNDRY_PROFILE=arc arc-forge script script/Deploy.s.sol --rpc-url arc --account doorstep-deployer --broadcast
```

Live demo on mainnet (about 0.13 USDC moves through Doorstep and comes back, minus gas):

```shell
bash scripts/demo-mainnet.sh      # asks for the keystore password once
```

Keeper:

```shell
cd keeper && npm install
DOORSTEP=0x... FROM_BLOCK=<deploy block> KEEPER_PRIVATE_KEY=0x... node keeper.mjs
```

App (dependencies are bundled, so the page loads no third-party scripts at runtime):

```shell
cd web && npm install && npm run build      # outputs web/dist/
```

Put the deployed addresses and deploy block in `web/dist/config.js` (or `web/config.js` before building), then publish `web/dist/` on any static host, such as GitHub Pages. Links accept `?chain=`, `?rpc=`, `?doorstep=` and `?escrow=` overrides.

## Mainnet proof

Deployed and exercised on Arc mainnet on 2026-10-11 (UTC) with `scripts/demo-mainnet.sh`, which uses only `arc-cast` and a local encrypted keystore. The script checks every receipt's status and the Doorstep event it emitted, and stops at the first mismatch. All steps passed.

| Step | What happened | Transaction |
| --- | --- | --- |
| Deploy | `Doorstep`, block 25488972, 1,257,811 gas | [`0x26ed6f67…`](https://explorer.arc.io/tx/0x26ed6f676fa6b86140ce919376ca7086148d4a734a8bf94be6b9fd2e39dd3836) |
| Deploy | `DemoEscrow`, block 25488973, 367,095 gas | [`0x4ac68483…`](https://explorer.arc.io/tx/0x4ac68483dac76c69cba4345049f845b217315b46c4f3c14d518fa8d205583509) |
| The problem | A plain wallet send of USDC straight to `DemoEscrow` reverts (`eth_estimateGas`) | n/a |
| Announce | Intent: deposit into `DemoEscrow` for the wallet, refunds to the wallet. Deposit address [`0xEB95f51A…1788a`](https://explorer.arc.io/address/0xEB95f51A3A2c2A931983FDB10939cfb102E1788a) | [`0x7ce28911…`](https://explorer.arc.io/tx/0x7ce28911df29ac79f78219c41d13abe3f8d8e941a2da7362e7feac5d1eb04d83) |
| Pay (native send) | 0.05 USDC sent to the deposit address like any wallet transfer | [`0x460b05a5…`](https://explorer.arc.io/tx/0x460b05a5def97439d547fb83f3f208e40a7019b7d19a12a2e90033d416484b5d) |
| Land → **Landed** | Escrow credits the beneficiary 0.045120 USDC; the rest repaid the keeper's gas | [`0x23b0e41b…`](https://explorer.arc.io/tx/0x23b0e41b0126ed54411a6bb07f45ccf94546cbd635d1a7df9b735bee1ec22243) |
| Pay (ERC-20 transfer) | 0.05 USDC via `USDC.transfer` to the **same address**, in a later transaction | [`0x31787653…`](https://explorer.arc.io/tx/0x3178765375904149480680978b0cfb9e77b2bb2435a65a667028eefce929fc44) |
| Land → **Landed** | Address reused; escrow credit 0.045120 → 0.090240 USDC | [`0xa261e1c5…`](https://explorer.arc.io/tx/0xa261e1c5226b3eecaf4ae2bf1d733973db86fb4fe8028fb63d03a1a7de753441) |
| Pay (expiring intent) | 0.03 USDC to a second intent's address [`0xA1C14A06…2159e`](https://explorer.arc.io/address/0xA1C14A0643425e69aB9435a5B51c90f369A2159e), which expires 45 s later | [`0xb4ac04a7…`](https://explorer.arc.io/tx/0xb4ac04a74ee8412cdef28107168a122b7cf49aac3e86ec3557bec757273f7fd5) |
| Land → **Bounced** | Expired, so the deposit is refunded to `refundTo` and the escrow credit is unchanged | [`0x479da99c…`](https://explorer.arc.io/tx/0x479da99ca21d995bbe90461077962622bf8000bc411f19737d6181970fbcfbe0) |
| Withdraw | The beneficiary withdraws 0.090240 USDC from the escrow | [`0xd891ae24…`](https://explorer.arc.io/tx/0xd891ae24d31c10cc18193e01219fa61a4d4164c4d6ab573669dbe0586954a4f7) |

After the run, Doorstep's balance is exactly 0. In this demo one wallet played payer, keeper and beneficiary, so the keeper fee (about 0.0049 USDC per landing, gas at Arc's 20 Gwei floor) went back to the same wallet. The whole run, deploy included, cost about 0.045 USDC in gas.

Still to show: an exchange withdrawal straight to a deposit address. It lands the same way as the native send above, because an exchange withdrawal on Arc is a native transfer.

## License

MIT. `test/ArcGenesis.sol` is generated from Apache-2.0 data in `circlefin/arc-node`.
