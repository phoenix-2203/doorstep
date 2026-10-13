// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, Vm, console} from "forge-std/Test.sol";
import {Doorstep} from "../src/Doorstep.sol";

interface IERC4626Like {
    function asset() external view returns (address);
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
    function totalAssets() external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function balanceOf(address) external view returns (uint256);
    function convertToAssets(uint256 shares) external view returns (uint256);
    function previewDeposit(uint256 assets) external view returns (uint256);
    function previewRedeem(uint256 shares) external view returns (uint256);
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256);
}

interface IUSDC {
    function balanceOf(address) external view returns (uint256);
}

/// Checks, against live Arc mainnet state, that Doorstep can deliver into a Morpho USDC vault and
/// that the credited person can take the money back out. Runs only on a mainnet fork:
///
///   FOUNDRY_PROFILE=arc arc-forge test --fork-url https://rpc.mainnet.arc.io --match-contract VaultFork -vv
///
/// Nothing here sends a real transaction; the fork is a local copy of mainnet.
contract VaultFork is Test {
    address constant USDC = 0x3600000000000000000000000000000000000000;
    // Live Doorstep v2 on Arc mainnet.
    Doorstep constant DOOR = Doorstep(0x56BD0FEfdaAF9d053a74107E6dDb9de19D306229);
    // Galaxy USDC, a Morpho Vault V2 on Arc, as listed on app.morpho.org (13 Oct 2026).
    // Override with VAULT=0x... to check another vault.
    address vaultAddr;
    IERC4626Like vault;

    address payer = makeAddr("payer");
    address keeper = makeAddr("keeper");
    address saver = makeAddr("saver");

    function setUp() public {
        if (block.chainid != 5042 || address(DOOR).code.length == 0) {
            vm.skip(true);
            return;
        }
        vaultAddr = vm.envOr("VAULT", address(0x8E357432CC12ff425c36432F312968aEb16112AF));
        vault = IERC4626Like(vaultAddr);
        vm.deal(payer, 100 ether); // 100 USDC (native, 18 decimals)
        vm.deal(keeper, 1 ether);
        vm.txGasPrice(block.basefee);
    }

    function _intent(uint256 min6) internal view returns (Doorstep.Intent memory i) {
        i.target = vaultAddr;
        i.callData = abi.encodeWithSignature("deposit(uint256,address)", uint256(0), saver);
        i.amountOffset = 4;
        i.refundTo = saver;
        i.minAmount6 = min6;
        i.maxKeeperFee6 = 10_000; // 0.01 USDC
        i.expiry = uint64(block.timestamp + 1 days);
        i.ref = bytes32("doorstep-earn");
    }

    function _gate(string memory sig) internal view returns (address gate, bool exists) {
        (bool ok, bytes memory ret) = vaultAddr.staticcall(abi.encodeWithSignature(sig));
        if (!ok || ret.length < 32) return (address(0), false);
        return (abi.decode(ret, (address)), true);
    }

    function test_vaultIsUsdcErc4626() public view {
        assertGt(vaultAddr.code.length, 0, "vault has code");
        assertEq(vault.asset(), USDC, "vault asset is Arc USDC");
        console.log("vault", vault.name(), vault.symbol());
        console.log("total assets (USDC 6dp)", vault.totalAssets());
        console.log("USDC idle in vault", IUSDC(USDC).balanceOf(vaultAddr));
        // Morpho Vault V2 can gate who receives shares or sends assets. Doorstep needs both open.
        string[4] memory gates = ["receiveSharesGate()", "sendSharesGate()", "receiveAssetsGate()", "sendAssetsGate()"];
        for (uint256 k = 0; k < gates.length; k++) {
            (address g, bool exists) = _gate(gates[k]);
            if (exists) {
                console.log(gates[k], g);
                assertEq(g, address(0), "gate must be open for Doorstep deliveries");
            }
        }
    }

    function test_deliverIntoVaultAndRedeem() public {
        Doorstep.Intent memory i = _intent(10_000); // 0.01 USDC minimum
        address dep = DOOR.addressOf(i);
        assertEq(dep.code.length, 0, "fresh deposit address");

        vm.prank(payer);
        (bool ok,) = dep.call{value: 5 ether}(""); // 5 USDC, like a wallet or exchange send
        assertTrue(ok, "plain send to the Doorstep address");

        uint256 expectedShares = vault.previewDeposit(4_990_000);
        vm.recordLogs();
        vm.prank(keeper, keeper);
        bool landed = DOOR.land(i);
        assertTrue(landed, "delivered into the vault (not bounced)");

        uint256 shares = vault.balanceOf(saver);
        assertGe(shares, expectedShares, "saver received vault shares");
        uint256 worth = vault.convertToAssets(shares);
        console.log("shares", shares);
        console.log("worth (USDC 6dp)", worth);
        assertGe(worth, 4_980_000, "shares worth the payment minus at most the 0.01 fee cap and rounding");
        assertLe(worth, 5_000_000, "not more than was paid");
        assertEq(dep.balance, 0, "deposit address emptied");
        assertEq(address(DOOR).balance, 0, "Doorstep holds nothing");

        // The saver takes it all back out.
        uint256 before = IUSDC(USDC).balanceOf(saver);
        vm.prank(saver);
        uint256 out = vault.redeem(shares, saver, saver);
        console.log("redeemed (USDC 6dp)", out);
        assertEq(IUSDC(USDC).balanceOf(saver) - before, out, "USDC arrives in the saver's wallet");
        assertGe(out + 1, worth, "redeemed what the shares were worth");
        assertEq(vault.balanceOf(saver), 0, "no shares left");
    }

    function test_smallestDemoPaymentStillLands() public {
        Doorstep.Intent memory i = _intent(10_000);
        address dep = DOOR.addressOf(i);
        vm.prank(payer);
        (bool ok,) = dep.call{value: 0.02 ether}(""); // 0.02 USDC
        assertTrue(ok);
        vm.prank(keeper, keeper);
        assertTrue(DOOR.land(i), "0.02 USDC delivers");
        assertGt(vault.balanceOf(saver), 0, "shares minted");
    }

    function test_cancelBeforeDeliveryReturnsEverything() public {
        Doorstep.Intent memory i = _intent(1_000_000); // waits for 1 USDC
        address dep = DOOR.addressOf(i);
        vm.prank(payer);
        (bool ok,) = dep.call{value: 0.3 ether}("");
        assertTrue(ok);
        uint256 before = saver.balance;
        vm.prank(saver);
        DOOR.cancel(i);
        assertEq(saver.balance - before, 0.3 ether, "every wei back to the refund wallet");
    }
}
