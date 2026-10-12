// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {Doorstep} from "../src/Doorstep.sol";
import {DemoEscrow} from "../src/DemoEscrow.sol";

/// Deploys Doorstep and the demo escrow on Arc.
///
///   FOUNDRY_PROFILE=arc arc-forge script script/Deploy.s.sol \
///     --rpc-url arc --account <keystore-name> --broadcast
///
/// Set DEPLOY_ESCROW=false to deploy Doorstep alone.
///
/// The script refuses to run on any chain other than Arc mainnet (5042), Arc testnet (5042002)
/// or a local `arc-anvil --network arc` node, and checks that Arc's USDC system contract is
/// where Doorstep expects it.
contract Deploy is Script {
    address constant USDC = 0x3600000000000000000000000000000000000000;
    uint256 constant ARC_MAINNET = 5042;
    uint256 constant ARC_TESTNET = 5042002;
    uint256 constant ARC_ANVIL = 31337; // arc-anvil --network arc (local rehearsal only)

    function run() external returns (Doorstep door, DemoEscrow escrow) {
        require(
            block.chainid == ARC_MAINNET || block.chainid == ARC_TESTNET || block.chainid == ARC_ANVIL,
            "not an Arc network"
        );
        require(USDC.code.length > 0, "USDC system contract missing");

        // DEPLOY_ESCROW=false deploys only Doorstep (e.g. a new Doorstep version next to an existing demo escrow).
        bool withEscrow = vm.envOr("DEPLOY_ESCROW", true);

        vm.startBroadcast();
        door = new Doorstep();
        if (withEscrow) escrow = new DemoEscrow();
        vm.stopBroadcast();

        require(door.LANDER_CODE_HASH() == keccak256(hex"608060405233fffe"), "unexpected lander code hash");

        console2.log("chain id        ", block.chainid);
        console2.log("Doorstep        ", address(door));
        if (withEscrow) console2.log("DemoEscrow      ", address(escrow));
        console2.logBytes32(door.LANDER_CODE_HASH());
    }
}
