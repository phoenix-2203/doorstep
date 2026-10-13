# Security notes

Doorstep has **not been audited**. This page says what the design protects against, what it doesn't, and what each moving part could do if it misbehaved, so you can judge the risk yourself. Use small amounts until there has been an independent review.

To report a problem, open a GitHub issue. For anything that could put funds at risk, ask for a private contact in the issue rather than posting details.

## What the contract guarantees

These follow from the code in [`src/Doorstep.sol`](src/Doorstep.sol) and are covered by [`test/Doorstep.t.sol`](test/Doorstep.t.sol) (32 tests under Arc's rules).

| Property | How |
| --- | --- |
| An address can't be redirected | The address is the CREATE2 address of a hash of the full instructions (`addressOf`). Changing the contract, call, refund wallet, minimum, fee limit, deadline or reference gives a different address. Pay pages, the SDK and the agent tool recompute it before showing it. |
| Money can only go to two places | `land` either calls the target named in the instructions or refunds `refundTo`. `cancel` only pays `refundTo`, and only `refundTo` can call it. |
| The target can't take more than the payment | Doorstep approves exactly the deliverable amount, calls the target, then sets the approval back to zero. Anything the target didn't take goes to `refundTo` (`test_greedyTargetCannotTakeStrays`, `test_partialPullRefundsRemainder`). |
| A landing can't spend money it didn't bring | Each landing only spends the difference it swept in; stray USDC in the contract is never paid out (`_settle`). |
| The delivery fee is bounded | The caller of `land` is repaid metered gas at most at twice the base fee, never more than `maxKeeperFee6`, and never more than what arrived (`test_keeperFeeIsCapped`, `test_keeperPriceCappedAtTwiceBaseFee`). Cancel charges no fee. |
| A short-gassed call can't force a refund | `land` keeps gas back and reverts instead of calling the target with too little gas, so a keeper can't make a good payment bounce on purpose (`test_underGassedLandingCannotForceBounce`, `test_outOfGasTargetNeverBounces`). |
| No re-entry | A transient (EIP-1153) lock covers `land` and `cancel` (`test_reentrancyBounces`). |
| No admin | No owner, no upgrade, no pause, no storage of balances. Nobody, including the deployer, can change the rules or move waiting money. |

## What it does not protect against

- **A bad link from the start.** The payer trusts whoever gave them the instructions, exactly as with any invoice. Someone can make a link that credits themselves. Mitigations: pay pages show the contract, beneficiary and refund wallet in plain words, and the agent tool's `check_payment` compares a link against what you expect.
- **A dishonest target contract.** If the target accepts the money but doesn't credit the beneficiary, Doorstep can't tell. Only pay into contracts you trust.
- **Wrong tokens or wrong networks.** Doorstep only moves USDC on Arc. Any other token sent to an address can never be moved, because nothing can ever run code there except Doorstep's sweep, which only takes USDC. The same goes for USDC sent to the same address on another chain.
- **A refund wallet that can't receive.** If `refundTo` is on USDC's blocklist or is a contract that rejects payments, a refund reverts and the money stays at the address until that changes (`test_blocklistedRefundToKeepsFundsAtAddress`). Use a plain wallet, and never an exchange deposit address, as the refund wallet.
- **Delay.** If no delivery bot runs, payments wait. They're safe, but nothing happens until someone calls `land` (anyone can, including the payer from the pay page) or `refundTo` cancels.
- **Bugs.** Tests and live mainnet runs are evidence, not proof. Not audited.

## The off-chain parts

None of them can move money anywhere the instructions don't allow. What each could do if compromised:

| Part | Holds | Worst case if compromised |
| --- | --- | --- |
| Delivery bot (`keeper/`) | A wallet with a little USDC for gas | Stops delivering (payments wait), or delivers with the fee capped by each address's limit. Can't change where money goes. |
| Hosted API (`api/`) | Hashed API keys, webhook secrets, a registration wallet with a few cents | Could hand integrators addresses with other instructions, or send false webhooks. Integrators should recompute addresses with the SDK (`depositAddress`) and check webhook signatures and on-chain events before releasing goods. |
| Website (`web/`) | Nothing; static files | A tampered site could show a different address. The page recomputes the address from the link itself, and the agent tool and SDK can verify links independently. |
| Agent tool (`agent/`) | Optionally a delivery wallet | Has no tool to send money; only creates, checks and delivers within operator limits. Refuses links for another contract or chain. |

## Known operational limits

- One public delivery bot runs today; anyone can run another ([keeper/README.md](keeper/README.md)).
- Arc's public RPC allows about one request per second per visitor, so the website paces its reads.
- Mainnet deployments: Doorstep v2 `0x56BD0FEfdaAF9d053a74107E6dDb9de19D306229`, v1 `0xd614A7B602E1417F258A834465AE01F47891e080` (no cancel; still works for its addresses).
