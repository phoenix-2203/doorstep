import type { Abi, Address, Hex, PublicClient, WalletClient, Chain, TransactionReceipt } from 'viem';

/** A Doorstep payment instruction, exactly as the contract sees it. */
export interface Intent {
  /** Contract that receives the deposit. */
  target: Address;
  /** Call made on `target`; it should pull the funds with transferFrom. */
  callData: Hex;
  /** Byte offset in callData where the amount (6 decimals) is written, or NO_AMOUNT. */
  amountOffset: number;
  /** Gets the money back if it can't be delivered, and may cancel at any time. */
  refundTo: Address;
  /** Delivery waits until at least this much (6-decimal units) has arrived. */
  minAmount6: bigint;
  /** Most the deliverer may be repaid for gas (6-decimal units). */
  maxKeeperFee6: bigint;
  /** Unix seconds. After this, anything waiting is refunded instead of delivered. */
  expiry: bigint;
  /** Your reference (invoice id etc.), emitted with every landing. */
  ref: Hex;
}

/** USDC as a string or number ("12.5"), or a bigint in 6-decimal units. */
export type UsdcAmount = string | number | bigint;
/** A Date, unix seconds, or a duration from now: "45s", "90m", "12h", "30d", "2w". */
export type Expires = Date | number | bigint | `${number}${'s' | 'm' | 'h' | 'd' | 'w'}`;

export interface CommonIntentOptions {
  refundTo: Address;
  /** Default "0". */
  minimum?: UsdcAmount;
  /** Default "0.01". */
  keeperFeeCap?: UsdcAmount;
  /** Default "30d". */
  expires?: Expires;
  /** Up to 31 bytes of text, or a 0x bytes32. */
  reference?: string;
  /** Override "now" (unix seconds) for duration-based expiries. */
  now?: number;
}

export interface MakeIntentOptions extends CommonIntentOptions {
  target: Address;
  abi?: Abi | readonly unknown[];
  functionName?: string;
  /** Put AMOUNT where the amount that arrived should go. */
  args?: readonly unknown[];
  /** Or pass ready-made calldata (and amountOffset). */
  callData?: Hex;
  amountOffset?: number;
}

export interface DepositIntentOptions extends CommonIntentOptions {
  /** Contract with deposit(uint256 amount, address beneficiary), e.g. any ERC-4626 vault. */
  into: Address;
  beneficiary: Address;
}

export interface Explanation {
  target: Address;
  call: { selector: Hex; name: string | null; args: readonly unknown[] | null; text: string };
  beneficiary: Address | null;
  refundTo: Address;
  minimum: string;
  keeperFeeCap: string;
  expiresAt: Date;
  expired: boolean;
  reference: string;
  writesAmount: boolean;
}

export interface DescribeOptions {
  abi?: Abi | readonly unknown[];
  /** Friendly names for addresses, e.g. { [vault]: 'the rent vault' }. */
  names?: Record<string, string>;
  /** Set false for v1 deployments, which have no cancel. */
  cancellable?: boolean;
  now?: number;
}

export interface Status {
  address: Address;
  /** USDC waiting, as a decimal string. */
  waiting: string;
  /** USDC waiting, native 18-decimal units. */
  waitingRaw: bigint;
  expired: boolean;
  expiresAt: Date;
  belowMinimum: boolean;
  canLand: boolean;
  canCancel: boolean;
  wouldBounce: boolean;
}

export interface DoorstepEvent {
  event: 'Landed' | 'Bounced' | 'Announced';
  transactionHash: Hex;
  blockNumber: bigint;
  intentHash: Hex;
  ref: Hex;
  depositAddress: Address;
  /** Landed */
  target?: Address;
  amountPulled6?: bigint;
  /** Bounced */
  refundTo?: Address;
  reason?: number;
  reasonText?: 'expired' | 'target call failed' | 'cancelled';
  revertData?: Hex;
  refunded?: bigint;
  keeperFee?: bigint;
}

export interface TxResult {
  hash: Hex;
  receipt: TransactionReceipt;
  event: DoorstepEvent | null;
}

export type WatchEvent =
  | { type: 'waiting'; address: Address; intentHash: Hex; waiting: string; waitingRaw: bigint }
  | ({ type: 'landed' | 'bounced' } & DoorstepEvent)
  | { type: 'error'; error: unknown };

export interface DoorstepClient {
  doorstep: Address;
  chain: Chain;
  publicClient: PublicClient;
  explorer?: string;
  makeIntent(o: MakeIntentOptions): Intent;
  depositIntent(o: DepositIntentOptions): Intent;
  depositAddress(intent: Intent): Address;
  describe(intent: Intent, o?: DescribeOptions): string;
  explain(intent: Intent, o?: DescribeOptions): Explanation;
  toLink(intent: Intent, o?: { baseUrl?: string; fromBlock?: bigint }): string;
  parseLink(link: string): { intent: Intent; fromBlock: bigint; doorstep?: Address; chainId?: number };
  status(intent: Intent): Promise<Status>;
  isAnnounced(intent: Intent, o?: { fromBlock?: bigint }): Promise<boolean>;
  history(intent: Intent, o?: { fromBlock?: bigint; toBlock?: bigint }): Promise<DoorstepEvent[]>;
  watch(intent: Intent, onChange: (e: WatchEvent) => void, o?: { pollMs?: number; fromBlock?: bigint }): () => void;
  waitForOutcome(intent: Intent, o?: { timeoutMs?: number; pollMs?: number }): Promise<WatchEvent>;
  /** Deliver (or refund, if expired). Anyone may call. */
  land(intent: Intent, o?: { walletClient?: WalletClient }): Promise<TxResult>;
  /** Refund everything waiting, now. Only refundTo may call. */
  cancel(intent: Intent, o?: { walletClient?: WalletClient }): Promise<TxResult>;
  announce(intent: Intent, o?: { walletClient?: WalletClient }): Promise<{ hash: Hex; receipt: TransactionReceipt; address: Address }>;
  txUrl(hash: Hex): string | null;
}

export interface CreateDoorstepOptions {
  network?: 'arc' | 'arcTestnet' | { id: number; name?: string; rpcUrl: string; explorer?: string };
  chainId?: number;
  rpcUrl?: string;
  /** Doorstep contract address (defaults to the official deployment for the chain). */
  doorstep?: Address;
  fromBlock?: bigint | number;
  explorer?: string;
  chain?: Chain;
  publicClient?: PublicClient;
  walletClient?: WalletClient;
}

export function createDoorstep(o?: CreateDoorstepOptions): DoorstepClient;
export function makeIntent(o: MakeIntentOptions): Intent;
export function depositIntent(o: DepositIntentOptions): Intent;
export function validateIntent(intent: Intent, doorstep?: Address): true;
export function intentHash(intent: Intent): Hex;
export function depositAddress(intent: Intent, doorstep: Address): Address;
export function explain(intent: Intent, o?: DescribeOptions): Explanation;
export function describe(intent: Intent, o?: DescribeOptions): string;
export function toLink(intent: Intent, o?: { baseUrl?: string; fromBlock?: bigint; doorstep?: Address; chainId?: number }): string;
export function parseLink(link: string): { intent: Intent; fromBlock: bigint; doorstep?: Address; chainId?: number };
export function toUnits6(v: UsdcAmount, field?: string): bigint;
export function toExpiry(e: Expires, now?: number): bigint;
export function toRef(reference?: string): Hex;
export function fromRef(ref: Hex): string;
export function formatUsdc6(v: bigint | number | string): string;
export function formatUsdc18(v: bigint | number | string): string;
export function explainRevert(err: unknown): unknown;
/** Chunked log scan that shrinks the block range when the RPC refuses it. */
export function scanLogs<T>(fetchRange: (from: bigint, to: bigint) => Promise<T[]>, fromBlock: bigint, toBlock: bigint, o?: { span?: bigint; minSpan?: bigint; onProgress?: (to: bigint) => void }): Promise<T[]>;

export class DoorstepError extends Error {
  details?: unknown;
}

export const AMOUNT: bigint;
export const NO_AMOUNT: number;
export const USDC: Address;
export const LANDER_CODE_HASH: Hex;
export const DOORSTEP_ABI: Abi;
export const INTENT_COMPONENTS: readonly { name: string; type: string }[];
export const NETWORKS: Record<'arc' | 'arcTestnet', { id: number; name: string; rpcUrl: string; explorer: string }>;
export const DEPLOYMENTS: Record<number, {
  doorstep: Address | null;
  fromBlock: bigint | null;
  legacy: { version: number; doorstep: Address; fromBlock: bigint }[];
  demoEscrow?: Address;
}>;
