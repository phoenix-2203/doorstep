// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20Like {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title DemoEscrow
/// @notice A deliberately ordinary escrow, written the way most EVM escrows are: no payable
///         receive(), deposits pulled with ERC-20 transferFrom. On Arc a wallet's plain "Send USDC"
///         is a native transfer, so sending straight to this contract reverts (the failure reported
///         in BreadchainCoop/curacao-crypto-onramp-bot#48). Doorstep is what makes it fundable from
///         any wallet, exchange or bridge without changing this contract.
contract DemoEscrow {
    address public constant USDC = 0x3600000000000000000000000000000000000000;

    mapping(address => uint256) public balanceOf6; // credited USDC per beneficiary (6 decimals)
    uint256 public totalHeld6;

    event Deposited(address indexed funder, address indexed beneficiary, uint256 amount6);
    event Withdrawn(address indexed beneficiary, address indexed to, uint256 amount6);

    error ZeroAmount();
    error InsufficientBalance();

    /// @notice Pull `amount6` USDC from the caller and credit `beneficiary`.
    function deposit(uint256 amount6, address beneficiary) external {
        if (amount6 == 0) revert ZeroAmount();
        require(IERC20Like(USDC).transferFrom(msg.sender, address(this), amount6), "transferFrom failed");
        balanceOf6[beneficiary] += amount6;
        totalHeld6 += amount6;
        emit Deposited(msg.sender, beneficiary, amount6);
    }

    /// @notice Beneficiary withdraws their credited USDC.
    function withdraw(uint256 amount6, address to) external {
        if (balanceOf6[msg.sender] < amount6) revert InsufficientBalance();
        balanceOf6[msg.sender] -= amount6;
        totalHeld6 -= amount6;
        require(IERC20Like(USDC).transfer(to, amount6), "transfer failed");
        emit Withdrawn(msg.sender, to, amount6);
    }
}
