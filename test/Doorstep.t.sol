// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, Vm} from "forge-std/Test.sol";
import {Doorstep} from "../src/Doorstep.sol";
import {DemoEscrow} from "../src/DemoEscrow.sol";
import {ArcGenesis} from "./ArcGenesis.sol";

interface IUSDCFull {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function decimals() external view returns (uint8);
}

/// Target that always reverts.
contract RevertingTarget {
    function deposit(uint256, address) external pure {
        revert("closed");
    }
}

/// Target that tries to land another intent while being called (reentrancy).
contract ReentrantTarget {
    Doorstep public door;
    Doorstep.Intent internal other;

    constructor(Doorstep d) {
        door = d;
    }

    function setOther(Doorstep.Intent memory i) external {
        other = i;
    }

    function deposit(uint256, address) external {
        door.land(other);
    }
}

/// Target that tries to pull more than it was approved for (would steal strays).
contract GreedyTarget {
    address constant USDC = 0x3600000000000000000000000000000000000000;

    function deposit(uint256 amount6, address) external {
        IUSDCFull(USDC).transferFrom(msg.sender, address(this), amount6 + 1_000_000);
    }
}

/// Target that pulls only part of what it was offered.
contract HalfTarget {
    address constant USDC = 0x3600000000000000000000000000000000000000;

    function deposit(uint256 amount6, address) external {
        IUSDCFull(USDC).transferFrom(msg.sender, address(this), amount6 / 2);
    }
}

/// Target that burns every unit of gas it is given.
contract GasBurner {
    function deposit(uint256, address) external pure {
        while (true) {}
    }
}

contract DoorstepTest is Test {
    address constant USDC_ADDR = 0x3600000000000000000000000000000000000000;
    address constant NATIVE_COIN_CONTROL = 0x1800000000000000000000000000000000000001;
    IUSDCFull constant USDC = IUSDCFull(USDC_ADDR);
    uint256 constant SCALE = 1e12;

    Doorstep door;
    DemoEscrow escrow;

    address payer = makeAddr("payer");
    address keeper = makeAddr("keeper");
    address alice = makeAddr("alice"); // beneficiary credited in the escrow
    address refundAddr = makeAddr("refund");

    function setUp() public {
        ArcGenesis.etchIfMissing(vm);
        door = new Doorstep();
        escrow = new DemoEscrow();
        vm.deal(payer, 1_000 ether); // 1,000 USDC (native, 18 decimals)
        vm.fee(20 gwei); // Arc base fee floor
        vm.txGasPrice(20 gwei);
    }

    // ------------------------------------------------------------ helpers

    function _intent(address target, uint256 min6, uint256 maxFee6, uint64 expiry, bytes32 ref)
        internal
        view
        returns (Doorstep.Intent memory i)
    {
        i.target = target;
        i.callData = abi.encodeCall(DemoEscrow.deposit, (0, alice));
        i.amountOffset = 4; // first argument, right after the 4-byte selector
        i.refundTo = refundAddr;
        i.minAmount6 = min6;
        i.maxKeeperFee6 = maxFee6;
        i.expiry = expiry;
        i.ref = ref;
    }

    function _escrowIntent() internal view returns (Doorstep.Intent memory) {
        return _intent(address(escrow), 1_000_000, 10_000, uint64(block.timestamp + 1 days), bytes32("order-1"));
    }

    function _sendNative(address to, uint256 amount) internal {
        vm.prank(payer);
        (bool ok,) = to.call{value: amount}("");
        require(ok, "native send failed");
    }

    function _land(Doorstep.Intent memory i) internal returns (bool) {
        vm.prank(keeper, keeper);
        return door.land(i);
    }

    function _blocklist(address a) internal {
        vm.store(NATIVE_COIN_CONTROL, keccak256(abi.encode(a, uint256(2))), bytes32(uint256(1)));
    }

    // ------------------------------------------------------------ environment sanity

    function test_arcEnvironment() public view {
        assertGt(USDC_ADDR.code.length, 0, "USDC system contract present");
        assertEq(USDC.decimals(), 6, "ERC-20 view is 6 decimals");
        // One balance, two interfaces.
        assertEq(USDC.balanceOf(payer), payer.balance / SCALE, "ERC-20 view of native balance");
    }

    // ------------------------------------------------------------ the problem (issue #48)

    function test_plainWalletSendToEscrowReverts() public {
        vm.prank(payer);
        (bool ok,) = address(escrow).call{value: 5 ether}("");
        assertFalse(ok, "non-payable escrow rejects a native send");
    }

    // ------------------------------------------------------------ happy paths

    function test_addressIsDeterministicAndCodeless() public view {
        Doorstep.Intent memory i = _escrowIntent();
        address a = door.addressOf(i);
        assertEq(a, door.addressOf(i));
        assertEq(a.code.length, 0);
        // Any change to the intent changes the address.
        i.refundTo = address(0xBEEF);
        assertTrue(door.addressOf(i) != a);
    }

    function test_nativeSendLandsInEscrow() public {
        Doorstep.Intent memory i = _escrowIntent();
        address dep = door.addressOf(i);
        _sendNative(dep, 5 ether); // 5 USDC via wallet "Send"

        uint256 keeperBefore = keeper.balance;
        assertTrue(_land(i));

        uint256 fee = keeper.balance - keeperBefore;
        assertGt(fee, 0, "keeper repaid");
        assertLe(fee, 10_000 * SCALE, "fee within cap");

        uint256 credited6 = escrow.balanceOf6(alice);
        assertEq(USDC.balanceOf(address(escrow)), credited6, "escrow holds the funds");
        // Every wei is accounted for: credited + keeper fee + refund (unused fee reserve and
        // sub-micro dust) equals the deposit exactly.
        assertEq(credited6 * SCALE + fee + refundAddr.balance, 5 ether, "conservation");
        assertLe(refundAddr.balance + fee, 10_000 * SCALE + SCALE, "credit short of deposit by at most cap + dust");
        assertEq(dep.balance, 0, "deposit address emptied");
        assertEq(dep.code.length, 0, "deposit address codeless again");
        assertEq(address(door).balance, 0, "factory holds nothing");
        assertEq(USDC.allowance(address(door), address(escrow)), 0, "approval revoked");
    }

    function test_erc20TransferLandsToo() public {
        Doorstep.Intent memory i = _escrowIntent();
        address dep = door.addressOf(i);
        vm.prank(payer);
        USDC.transfer(dep, 3_000_000); // 3 USDC via the ERC-20 interface
        assertEq(dep.balance, 3 ether, "same balance either way");

        assertTrue(_land(i));
        assertGt(escrow.balanceOf6(alice), 2_990_000);
        assertEq(address(door).balance, 0);
    }

    // Address reuse across transactions is proven on a real Arc node (hardfork Zero8) by
    // keeper/e2e.mjs step 3. Forge runs a test as one transaction (even with --isolate it keeps
    // Arc's self-destructed flag), so it cannot model a second deposit in a later transaction.

    /// Within one transaction Arc refuses value to an account that self-destructed in it.
    function test_sameTxResendIsRejectedByArc() public {
        Doorstep.Intent memory i = _escrowIntent();
        address dep = door.addressOf(i);
        _sendNative(dep, 2 ether);
        assertTrue(_land(i));
        vm.prank(payer);
        (bool ok,) = dep.call{value: 1 ether}("");
        assertFalse(ok, "Arc: no value to an account self-destructed earlier in this transaction");
    }

    function test_landedEventCarriesRef() public {
        Doorstep.Intent memory i = _escrowIntent();
        address dep = door.addressOf(i);
        _sendNative(dep, 2 ether);
        vm.recordLogs();
        _land(i);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 k; k < logs.length; k++) {
            if (logs[k].emitter == address(door) && logs[k].topics[0] == Doorstep.Landed.selector) {
                assertEq(logs[k].topics[1], door.intentHash(i));
                assertEq(logs[k].topics[2], bytes32("order-1"));
                found = true;
            }
        }
        assertTrue(found, "Landed emitted");
    }

    // ------------------------------------------------------------ bounces

    function test_expiredIntentRefunds() public {
        Doorstep.Intent memory i = _escrowIntent();
        address dep = door.addressOf(i);
        _sendNative(dep, 5 ether);
        vm.warp(i.expiry + 1);

        uint256 keeperBefore = keeper.balance;
        assertFalse(_land(i));
        uint256 fee = keeper.balance - keeperBefore;
        assertEq(refundAddr.balance, 5 ether - fee, "everything but the fee refunded");
        assertEq(escrow.balanceOf6(alice), 0);
        assertEq(address(door).balance, 0);
    }

    function test_revertingTargetRefunds() public {
        RevertingTarget bad = new RevertingTarget();
        Doorstep.Intent memory i = _intent(address(bad), 0, 10_000, uint64(block.timestamp + 1 days), "x");
        _sendNative(door.addressOf(i), 5 ether);
        uint256 keeperBefore = keeper.balance;
        assertFalse(_land(i));
        assertEq(refundAddr.balance, 5 ether - (keeper.balance - keeperBefore));
        assertEq(USDC.allowance(address(door), address(bad)), 0);
    }

    function test_codelessTargetRefunds() public {
        Doorstep.Intent memory i = _intent(makeAddr("eoa"), 0, 10_000, uint64(block.timestamp + 1 days), "x");
        _sendNative(door.addressOf(i), 1 ether);
        assertFalse(_land(i), "calling an EOA is not a successful deposit");
        assertGt(refundAddr.balance, 0);
    }

    function test_partialPullRefundsRemainder() public {
        HalfTarget half = new HalfTarget();
        Doorstep.Intent memory i = _intent(address(half), 0, 10_000, uint64(block.timestamp + 1 days), "x");
        _sendNative(door.addressOf(i), 4 ether);
        uint256 keeperBefore = keeper.balance;
        assertTrue(_land(i));
        uint256 fee = keeper.balance - keeperBefore;
        uint256 pulled = USDC.balanceOf(address(half)) * SCALE;
        assertEq(pulled + refundAddr.balance + fee, 4 ether, "every wei accounted for");
        assertEq(address(door).balance, 0);
    }

    // ------------------------------------------------------------ guards

    function test_belowMinimumWaitsForMore() public {
        Doorstep.Intent memory i = _escrowIntent(); // min 1 USDC
        address dep = door.addressOf(i);
        _sendNative(dep, 0.5 ether);
        vm.prank(keeper, keeper);
        vm.expectRevert(abi.encodeWithSelector(Doorstep.BelowMinimum.selector, 500_000, 1_000_000));
        door.land(i);
        assertEq(dep.balance, 0.5 ether, "funds stay at the address");

        _sendNative(dep, 0.7 ether); // top-up
        assertTrue(_land(i));
        assertGt(escrow.balanceOf6(alice), 1_190_000);
    }

    function test_nothingToLand() public {
        vm.prank(keeper, keeper);
        vm.expectRevert(Doorstep.NothingToLand.selector);
        door.land(_escrowIntent());
    }

    function test_invalidIntents() public {
        Doorstep.Intent memory i = _escrowIntent();
        _sendNative(door.addressOf(i), 1 ether);

        Doorstep.Intent memory bad = _escrowIntent();
        bad.target = USDC_ADDR;
        vm.expectRevert(Doorstep.InvalidIntent.selector);
        door.land(bad);

        bad = _escrowIntent();
        bad.target = address(door);
        vm.expectRevert(Doorstep.InvalidIntent.selector);
        door.land(bad);

        bad = _escrowIntent();
        bad.refundTo = address(0);
        vm.expectRevert(Doorstep.InvalidIntent.selector);
        door.land(bad);

        bad = _escrowIntent();
        bad.amountOffset = uint32(bad.callData.length - 31);
        vm.expectRevert(Doorstep.InvalidIntent.selector);
        door.land(bad);
    }

    function test_keeperFeeIsCapped() public {
        Doorstep.Intent memory i = _intent(address(escrow), 0, 1_000, uint64(block.timestamp + 1 days), "x"); // cap 0.001
        _sendNative(door.addressOf(i), 5 ether);
        vm.txGasPrice(100_000 gwei); // keeper tries an absurd price
        uint256 keeperBefore = keeper.balance;
        _land(i);
        assertLe(keeper.balance - keeperBefore, 1_000 * SCALE, "never above the intent's cap");
    }

    function test_keeperPriceCappedAtTwiceBaseFee() public {
        Doorstep.Intent memory i = _intent(address(escrow), 0, 1_000_000, uint64(block.timestamp + 1 days), "x"); // cap 1 USDC
        _sendNative(door.addressOf(i), 5 ether);
        vm.txGasPrice(10_000 gwei);
        uint256 keeperBefore = keeper.balance;
        _land(i);
        uint256 fee = keeper.balance - keeperBefore;
        // At most ~500k gas at 2 x 20 gwei: far below what 10,000 gwei would have paid.
        assertLe(fee, 500_000 * 40 gwei);
    }

    function test_reentrancyBounces() public {
        ReentrantTarget re = new ReentrantTarget(door);
        Doorstep.Intent memory inner = _escrowIntent();
        _sendNative(door.addressOf(inner), 2 ether);
        re.setOther(inner);

        Doorstep.Intent memory outer = _intent(address(re), 0, 10_000, uint64(block.timestamp + 1 days), "o");
        _sendNative(door.addressOf(outer), 2 ether);
        assertFalse(_land(outer), "nested land rejected, outer bounces");
        assertEq(door.addressOf(inner).balance, 2 ether, "inner deposit untouched");
    }

    function test_greedyTargetCannotTakeStrays() public {
        // Someone mistakenly sends USDC straight to the factory via the ERC-20 interface.
        vm.prank(payer);
        USDC.transfer(address(door), 7_000_000);

        GreedyTarget greedy = new GreedyTarget();
        Doorstep.Intent memory i = _intent(address(greedy), 0, 10_000, uint64(block.timestamp + 1 days), "g");
        _sendNative(door.addressOf(i), 2 ether);
        assertFalse(_land(i), "over-pull fails, deposit bounces");
        assertEq(address(door).balance, 7 ether, "strays untouched");
        assertEq(USDC.balanceOf(address(greedy)), 0);
    }

    function test_factoryRejectsDirectNativeSends() public {
        vm.prank(payer);
        (bool ok,) = address(door).call{value: 1 ether}("");
        assertFalse(ok);
    }

    function test_outOfGasTargetNeverBounces() public {
        GasBurner burner = new GasBurner();
        Doorstep.Intent memory i = _intent(address(burner), 0, 10_000, uint64(block.timestamp + 1 days), "b");
        address dep = door.addressOf(i);
        _sendNative(dep, 2 ether);

        vm.prank(keeper, keeper);
        vm.expectRevert(Doorstep.InsufficientGas.selector);
        door.land{gas: 2_000_000}(i);
        assertEq(dep.balance, 2 ether, "an out-of-gas target cannot force a bounce");

        // Once expired, the refund path never calls the target, so the deposit comes home.
        vm.warp(i.expiry + 1);
        assertFalse(_land(i));
        assertGt(refundAddr.balance, 1.99 ether);
    }

    function test_underGassedLandingCannotForceBounce() public {
        Doorstep.Intent memory i = _escrowIntent();
        address dep = door.addressOf(i);
        _sendNative(dep, 2 ether);
        // Try a range of tight gas limits: each must either land properly or revert entirely.
        for (uint256 g = 150_000; g < 450_000; g += 5_000) {
            uint256 snap = vm.snapshotState();
            vm.prank(keeper, keeper);
            try door.land{gas: g}(i) returns (bool landed) {
                assertTrue(landed, "a tight gas limit must not produce a bounce");
                assertEq(escrow.balanceOf6(alice) * SCALE + keeper.balance + refundAddr.balance, 2 ether, "conservation");
            } catch {
                assertEq(dep.balance, 2 ether, "reverted landings leave funds in place");
            }
            vm.revertToState(snap);
        }
    }

    // ------------------------------------------------------------ early cancel

    function test_cancelRefundsBeforeExpiry() public {
        Doorstep.Intent memory i = _escrowIntent(); // min 1 USDC, expires in a day
        address dep = door.addressOf(i);
        _sendNative(dep, 0.5 ether); // below the minimum: cannot land yet

        vm.expectEmit(true, true, true, true, address(door));
        emit Doorstep.Bounced(
            door.intentHash(i), i.ref, refundAddr, dep, Doorstep.BounceReason.Cancelled, 0.5 ether, 0, ""
        );
        vm.prank(refundAddr, refundAddr);
        uint256 refunded = door.cancel(i);

        assertEq(refunded, 0.5 ether, "returns what it refunded");
        assertEq(refundAddr.balance, 0.5 ether, "every wei back, no keeper fee");
        assertEq(dep.balance, 0, "address emptied");
        assertEq(dep.code.length, 0, "address codeless again");
        assertEq(escrow.balanceOf6(alice), 0, "nothing delivered");
        assertEq(address(door).balance, 0, "factory holds nothing");
    }

    function test_cancelAfterExpiryAlsoWorks() public {
        Doorstep.Intent memory i = _escrowIntent();
        _sendNative(door.addressOf(i), 2 ether);
        vm.warp(i.expiry + 1);
        vm.prank(refundAddr, refundAddr);
        assertEq(door.cancel(i), 2 ether);
        assertEq(refundAddr.balance, 2 ether);
    }

    function test_onlyRefundToCanCancel() public {
        Doorstep.Intent memory i = _escrowIntent();
        address dep = door.addressOf(i);
        _sendNative(dep, 2 ether);

        address[3] memory others = [keeper, payer, alice];
        for (uint256 k = 0; k < others.length; k++) {
            vm.prank(others[k], others[k]);
            vm.expectRevert(Doorstep.NotRefundTo.selector);
            door.cancel(i);
        }
        assertEq(dep.balance, 2 ether, "funds untouched");
    }

    function test_cancelWithNothingWaitingReverts() public {
        vm.prank(refundAddr, refundAddr);
        vm.expectRevert(Doorstep.NothingToLand.selector);
        door.cancel(_escrowIntent());
    }

    function test_cancelErc20Deposit() public {
        Doorstep.Intent memory i = _escrowIntent();
        address dep = door.addressOf(i);
        vm.prank(payer);
        USDC.transfer(dep, 1_234_567); // 1.234567 USDC through the ERC-20 interface
        vm.prank(refundAddr, refundAddr);
        assertEq(door.cancel(i), 1_234_567 * SCALE);
        assertEq(refundAddr.balance, 1_234_567 * SCALE);
    }

    function test_cancelInvalidIntentReverts() public {
        Doorstep.Intent memory i = _escrowIntent();
        i.target = USDC_ADDR;
        vm.prank(refundAddr, refundAddr);
        vm.expectRevert(Doorstep.InvalidIntent.selector);
        door.cancel(i);
    }

    function test_cancelToBlocklistedRefundToKeepsFunds() public {
        Doorstep.Intent memory i = _escrowIntent();
        address dep = door.addressOf(i);
        _sendNative(dep, 3 ether);
        _blocklist(refundAddr);
        vm.prank(refundAddr, refundAddr);
        vm.expectRevert();
        door.cancel(i);
        assertEq(dep.balance, 3 ether, "nothing moved");
    }

    // ------------------------------------------------------------ Arc blocklist

    function test_blocklistedRefundToKeepsFundsAtAddress() public {
        Doorstep.Intent memory i = _escrowIntent();
        address dep = door.addressOf(i);
        _sendNative(dep, 3 ether);
        vm.warp(i.expiry + 1); // force the refund path
        _blocklist(refundAddr);

        vm.prank(keeper, keeper);
        vm.expectRevert();
        door.land(i);
        assertEq(dep.balance, 3 ether, "nothing moved; funds wait at the address");
    }

    function test_announceEmitsAddress() public {
        Doorstep.Intent memory i = _escrowIntent();
        vm.recordLogs();
        address a = door.announce(i);
        assertEq(a, door.addressOf(i));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1);
        assertEq(logs[0].topics[1], door.intentHash(i));
        assertEq(logs[0].topics[2], bytes32(uint256(uint160(a))));
        Doorstep.Intent memory decoded = abi.decode(logs[0].data, (Doorstep.Intent));
        assertEq(door.intentHash(decoded), door.intentHash(i), "intent recoverable from the log");
    }

    // ------------------------------------------------------------ off-chain parity

    /// The web app and keeper derive addresses with viem (keeper/vector.mjs). This pins the
    /// contract to the same answer, so a payer is never shown an address the contract disagrees with.
    function test_addressMatchesViemVector() public {
        address factory = 0x1111111111111111111111111111111111111111;
        deployCodeTo("Doorstep.sol:Doorstep", factory);
        Doorstep d = Doorstep(factory);
        assertEq(d.LANDER_CODE_HASH(), keccak256(hex"608060405233fffe"), "lander initcode as expected");

        Doorstep.Intent memory i;
        i.target = 0x2222222222222222222222222222222222222222;
        i.callData = hex"6e553f6500000000000000000000000000000000000000000000000000000000000000000000000000000000000000003333333333333333333333333333333333333333";
        i.amountOffset = 4;
        i.refundTo = 0x4444444444444444444444444444444444444444;
        i.minAmount6 = 50_000;
        i.maxKeeperFee6 = 10_000;
        i.expiry = 1760140800;
        i.ref = bytes32("order-1");

        assertEq(d.intentHash(i), 0x1f36ff0db753b4e9ec34591ef38a4a3ca34b5c91db1d46d892f0d59b5e2c4185);
        assertEq(d.addressOf(i), 0x028053E7CDdCB91618502Fd6a6E4Cb47cDBB17D7);
    }

    // ------------------------------------------------------------ fuzz

    function testFuzz_conservation(uint96 amount) public {
        uint256 amt = bound(uint256(amount), 1 ether, 500 ether);
        Doorstep.Intent memory i = _intent(address(escrow), 0, 10_000, uint64(block.timestamp + 1 days), "f");
        _sendNative(door.addressOf(i), amt);
        uint256 keeperBefore = keeper.balance;
        assertTrue(_land(i));
        uint256 fee = keeper.balance - keeperBefore;
        uint256 credited = escrow.balanceOf6(alice) * SCALE;
        assertEq(credited + fee + refundAddr.balance, amt, "conservation of USDC");
        assertLe(refundAddr.balance + fee, 10_000 * SCALE + SCALE, "deduction bounded by the fee cap plus dust");
        assertEq(address(door).balance, 0);
    }
}
