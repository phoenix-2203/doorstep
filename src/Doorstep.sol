// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Minimal ERC-20 surface of Arc's USDC system contract (6-decimal view of the native balance).
interface IUSDC {
    function approve(address spender, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}

/// @dev Deployed at an intent's CREATE2 address only for the duration of one landing.
///      Its constructor hands everything the address holds to the factory and deletes itself
///      (EIP-6780: created and destroyed in the same transaction, so the address is codeless
///      again afterwards and can receive and land further deposits).
///      On Arc, native USDC *is* the balance, so SELFDESTRUCT moves the deposit, whether it
///      arrived as a native send, an ERC-20 transfer, an exchange withdrawal or a CCTP mint.
contract DoorstepLander {
    constructor() payable {
        selfdestruct(payable(msg.sender));
    }
}

/// @title Doorstep
/// @notice Call-on-arrival deposit addresses for Arc.
///
/// An intent says: "whatever USDC lands at this address, deposit it into `target` by calling
/// `callData` (with the amount written in at `amountOffset`), and if that is impossible, send it
/// to `refundTo`". The address is a pure function of the intent, so it can be handed out
/// before anything is deployed, and anyone can recompute it to check what it does.
///
/// Anyone may call `land(intent)`. The caller is repaid the gas it spent out of the deposit
/// itself, which is plain arithmetic on Arc because gas is paid in USDC. The repayment is capped
/// by `maxKeeperFee6`.
///
/// Trust model: the payer trusts whoever gave them the intent (exactly as with any invoice or
/// payment link). Doorstep holds no funds between transactions and keeps no balances in storage.
contract Doorstep {
    /// @notice Arc's USDC: one balance, native (18 decimals) and ERC-20 (6 decimals) interfaces.
    address public constant USDC = 0x3600000000000000000000000000000000000000;

    /// @notice Native units (18 decimals) per ERC-20 unit (6 decimals).
    uint256 internal constant SCALE = 1e12;

    /// @notice `amountOffset` value meaning "do not write the amount into the calldata".
    uint32 public constant NO_AMOUNT = type(uint32).max;

    /// @notice Gas spent after the final meter reading: the refund and fee transfers (value
    ///         transfers on Arc include blocklist checks), the event and the return. Calibrated
    ///         against arc-anvil on hardfork Zero8 (keeper/feecheck.mjs: fee within +2-3% of gas cost).
    uint256 public constant TAIL_GAS = 22_000;

    /// @notice Gas refunded at the end of the transaction when the USDC allowance goes from zero to
    ///         an amount and back to zero (EIP-2200/EIP-3529: restoring a slot's original value
    ///         refunds 20,000 - 100). The keeper never pays it, so it is not charged.
    uint256 public constant ALLOWANCE_REFUND = 19_900;

    /// @notice Upper-bound estimate for the target call and its approvals, used only to reserve
    ///         the fee before the call so the amount credited is known in advance. The keeper is
    ///         paid what was actually used; the unused part of the reserve goes to refundTo.
    uint256 public constant DELIVERY_GAS_ESTIMATE = 150_000;

    /// @notice Gas kept back from the target call so the refund path can always run.
    uint256 internal constant GAS_RESERVE = 120_000;

    /// @notice Least gas the target call is ever given. Below this, `land` reverts instead of trying.
    uint256 internal constant MIN_TARGET_GAS = 100_000;

    struct Intent {
        address target; // contract to fund
        bytes callData; // call to make on target; it should pull the funds with transferFrom
        uint32 amountOffset; // byte offset in callData of a uint256 amount (6 decimals), or NO_AMOUNT
        address refundTo; // receives the deposit if it cannot land (must not be an exchange hot wallet)
        uint256 minAmount6; // landing waits until at least this much (6 decimals) has arrived
        uint256 maxKeeperFee6; // most the lander may be repaid (6 decimals)
        uint64 expiry; // after this timestamp, anything that arrives is refunded
        bytes32 ref; // caller-defined reference (order id, invoice id), emitted on landing
    }

    enum BounceReason {
        Expired,
        CallFailed
    }

    event Landed(
        bytes32 indexed intentHash,
        bytes32 indexed ref,
        address indexed target,
        address depositAddress,
        uint256 amountPulled6,
        uint256 refunded,
        uint256 keeperFee
    );

    event Bounced(
        bytes32 indexed intentHash,
        bytes32 indexed ref,
        address indexed refundTo,
        address depositAddress,
        BounceReason reason,
        uint256 refunded,
        uint256 keeperFee,
        bytes revertData
    );

    /// @notice Published so keepers can discover intents from logs alone (no server, no storage).
    event Announced(bytes32 indexed intentHash, address indexed depositAddress, Intent intent);

    error InvalidIntent();
    error NothingToLand();
    error BelowMinimum(uint256 arrived6, uint256 minAmount6);
    error Reentrancy();
    error NativeTransferFailed(address to);
    error InsufficientGas();

    bytes32 public immutable LANDER_CODE_HASH = keccak256(type(DoorstepLander).creationCode);

    // ---------------------------------------------------------------- views

    function intentHash(Intent calldata intent) public pure returns (bytes32) {
        return keccak256(abi.encode(intent));
    }

    /// @notice The deposit address for an intent. Pure function of the intent and this factory.
    function addressOf(Intent calldata intent) public view returns (address) {
        return _addressOf(intentHash(intent));
    }

    /// @notice USDC waiting at an intent's address, in native units (18 decimals).
    function pending(Intent calldata intent) external view returns (uint256) {
        return addressOf(intent).balance;
    }

    // ---------------------------------------------------------------- discovery

    /// @notice Emit an intent so any keeper can find its address and land deposits. Optional:
    ///         landing works for any intent whether or not it was announced. Writes no storage.
    function announce(Intent calldata intent) external returns (address depositAddress) {
        bytes32 h = intentHash(intent);
        depositAddress = _addressOf(h);
        _validate(intent, depositAddress);
        emit Announced(h, depositAddress, intent);
    }

    // ---------------------------------------------------------------- landing

    /// @dev Per-landing bookkeeping, kept in memory to stay clear of stack limits.
    struct Landing {
        bytes32 h;
        address depositAddress;
        uint256 before; // factory balance before this landing (never spent by it)
        uint256 arrived; // native units swept from the deposit address
        uint256 fee; // keeper repayment, native units
        uint256 pulled6; // what the target took, 6 decimals
        uint256 refund; // native units sent to refundTo
        bool expired;
        bool landed;
        bytes revertData;
    }

    /// @notice Move whatever sits at the intent's address into its target, or refund it.
    /// @return landed True if the target call succeeded, false if the deposit bounced.
    function land(Intent calldata intent) external returns (bool landed) {
        uint256 gasStart = gasleft();
        _enter();

        Landing memory l;
        l.h = intentHash(intent);
        l.depositAddress = _addressOf(l.h);
        _validate(intent, l.depositAddress);
        if (l.depositAddress.balance == 0) revert NothingToLand();

        // Sweep the deposit into the factory. Only this landing's delta is ever spent.
        l.before = address(this).balance;
        new DoorstepLander{salt: l.h}();
        l.arrived = address(this).balance - l.before;
        if (l.arrived == 0) revert NothingToLand();

        l.expired = block.timestamp > intent.expiry;
        if (!l.expired && l.arrived / SCALE < intent.minAmount6) {
            revert BelowMinimum(l.arrived / SCALE, intent.minAmount6); // reverts the sweep too
        }

        // Reserve an upper bound for the fee so the amount offered to the target is fixed up front.
        l.fee = _keeperFee(gasStart, intent.maxKeeperFee6, l.arrived, l.expired ? 0 : DELIVERY_GAS_ESTIMATE);
        if (!l.expired) _deliver(intent, l);
        // Then pay the keeper what was actually used (never more than the reserve).
        uint256 exact = _keeperFee(gasStart, intent.maxKeeperFee6, l.arrived, 0);
        if (!l.expired) {
            // The approve/revoke round trip is refunded at the end of the transaction.
            uint256 price = _price();
            uint256 credit = ALLOWANCE_REFUND * price;
            exact = exact > credit ? exact - credit : 0;
        }
        if (exact < l.fee) l.fee = exact;
        _settle(intent.refundTo, l);
        if (l.fee > 0) _sendNative(msg.sender, l.fee);

        landed = l.landed;
        if (landed) {
            emit Landed(l.h, intent.ref, intent.target, l.depositAddress, l.pulled6, l.refund, l.fee);
        } else {
            emit Bounced(
                l.h,
                intent.ref,
                intent.refundTo,
                l.depositAddress,
                l.expired ? BounceReason.Expired : BounceReason.CallFailed,
                l.refund,
                l.fee,
                l.revertData
            );
        }
        _exit();
    }

    function _validate(Intent calldata intent, address depositAddress) internal view {
        if (intent.target == address(0) || intent.refundTo == address(0)) revert InvalidIntent();
        // The factory must never approve or call USDC itself, or call itself.
        if (intent.target == USDC || intent.target == address(this)) revert InvalidIntent();
        // Arc reverts value sends to an account that self-destructed earlier in the same tx.
        if (intent.refundTo == depositAddress || intent.target == depositAddress) revert InvalidIntent();
        if (intent.amountOffset != NO_AMOUNT && uint256(intent.amountOffset) + 32 > intent.callData.length) {
            revert InvalidIntent();
        }
    }

    /// @dev Approve exactly the deliverable amount, call the target, revoke, measure what it took.
    ///      `l.fee` here is the reserved upper bound, so the amount offered is fixed before the call.
    function _deliver(Intent calldata intent, Landing memory l) internal {
        // Sub-micro-USDC dust cannot move through the 6-decimal ERC-20 interface; it is refunded.
        uint256 amount6 = (l.arrived - l.fee) / SCALE;
        bytes memory data = intent.callData;
        if (intent.amountOffset != NO_AMOUNT) {
            uint256 off = intent.amountOffset;
            assembly {
                mstore(add(add(data, 32), off), amount6)
            }
        }

        uint256 balBeforeCall = address(this).balance;
        IUSDC(USDC).approve(intent.target, amount6);
        (l.landed, l.revertData) = _callTarget(intent.target, data);
        IUSDC(USDC).approve(intent.target, 0);

        uint256 balAfterCall = address(this).balance;
        if (l.landed && balAfterCall < balBeforeCall) l.pulled6 = (balBeforeCall - balAfterCall) / SCALE;
    }

    /// @dev Everything this landing brought that neither the target nor the keeper took goes to refundTo.
    function _settle(address refundTo, Landing memory l) internal {
        uint256 available = l.arrived - l.fee;
        uint256 spent = l.pulled6 * SCALE;
        l.refund = available > spent ? available - spent : 0;
        // Never let a landing spend funds it did not bring (e.g. stray USDC sitting in the factory).
        uint256 nowBal = address(this).balance;
        uint256 floor = l.before + l.fee;
        if (nowBal < floor + l.refund) l.refund = nowBal > floor ? nowBal - floor : 0;
        if (l.refund > 0) _sendNative(refundTo, l.refund);
    }

    // ---------------------------------------------------------------- internals

    function _addressOf(bytes32 h) internal view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), h, LANDER_CODE_HASH)))));
    }

    /// @dev Metered gas at a capped price: min(tx.gasprice, 2 * basefee). Same idea as legwork's
    ///      self-repaying executor. Never more than maxKeeperFee6, never more than what arrived.
    ///      Gas outside the metered window: 21,000 intrinsic, calldata at 16 per byte (an upper
    ///      bound; zero bytes cost 4), and TAIL_GAS for the work after the last reading.
    function _keeperFee(uint256 gasStart, uint256 maxKeeperFee6, uint256 arrived, uint256 extraGas)
        internal
        view
        returns (uint256 fee)
    {
        uint256 price = _price();
        uint256 used = gasStart - gasleft() + 21_000 + 16 * msg.data.length + TAIL_GAS + extraGas;
        fee = used * price;
        uint256 cap = maxKeeperFee6 * SCALE;
        if (fee > cap) fee = cap;
        if (fee > arrived) fee = arrived;
    }

    /// @dev The price the keeper is repaid at: what it paid, but never more than twice the base fee.
    function _price() internal view returns (uint256 price) {
        price = tx.gasprice;
        uint256 ceiling = 2 * block.basefee;
        if (price > ceiling) price = ceiling;
    }

    /// @dev Call without copying unbounded return data (no return-bomb), keeping gas back for refunds.
    function _callTarget(address target, bytes memory data) internal returns (bool ok, bytes memory revertData) {
        // A call to an address with no code "succeeds" without doing anything; treat it as a failure.
        if (target.code.length == 0) return (false, "");
        uint256 g = gasleft();
        if (g < GAS_RESERVE + MIN_TARGET_GAS) revert InsufficientGas();
        uint256 forward = g - GAS_RESERVE;
        // Keep `forward` under the EIP-150 63/64 ceiling so the callee receives exactly `forward`.
        uint256 ceiling = g - g / 64 - 5_000;
        if (forward > ceiling) forward = ceiling;
        uint256 before = gasleft();
        assembly {
            ok := call(forward, target, 0, add(data, 32), mload(data), 0, 0)
            let size := returndatasize()
            if gt(size, 256) { size := 256 }
            revertData := mload(0x40)
            mstore(revertData, size)
            returndatacopy(add(revertData, 32), 0, size)
            mstore(0x40, add(add(revertData, 32), and(add(size, 31), not(31))))
        }
        if (ok) {
            revertData = "";
        } else if (before - gasleft() >= forward) {
            // The target ran out of the gas it was given. That may be the caller's doing (a keeper
            // can choose a tight gas limit), so never let it turn into a bounce: revert everything.
            // A target that can never succeed is still refunded once the intent expires, because
            // the expiry path does not call the target.
            revert InsufficientGas();
        }
    }

    function _sendNative(address to, uint256 amount) internal {
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert NativeTransferFailed(to);
    }

    // Transient reentrancy lock (EIP-1153).
    function _enter() internal {
        bool locked;
        assembly {
            locked := tload(0)
        }
        if (locked) revert Reentrancy();
        assembly {
            tstore(0, 1)
        }
    }

    function _exit() internal {
        assembly {
            tstore(0, 0)
        }
    }
}
