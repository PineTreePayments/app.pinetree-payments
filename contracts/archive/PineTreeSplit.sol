// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// PineTree Split Contract — Base Network
// Supports ETH and ERC-20 tokens (e.g. USDC on Base).
// Deployed once on Base; handles all merchants.
// Owner can pause in emergencies.

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}

contract PineTreeSplit {
    address public owner;
    bool public paused;

    event PaymentSplit(
        address indexed merchant,
        address indexed treasury,
        uint256 merchantAmount,
        uint256 feeAmount,
        string  paymentRef,
        address indexed payer,
        address token  // address(0) = ETH
    );

    event Paused(address by);
    event Unpaused(address by);

    error InvalidAddress();
    error InvalidAmounts();
    error MissingReference();
    error InsufficientPayment(uint256 sent, uint256 required);
    error TransferFailed();
    error ContractPaused();
    error OnlyOwner();
    error ETHNotAccepted();

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // ─────────────────────────────────────────────────────────────
    // ETH split
    // ─────────────────────────────────────────────────────────────

    function split(
        address payable merchant,
        address payable treasury,
        uint256 merchantAmountWei,
        uint256 feeAmountWei,
        string calldata paymentRef
    ) external payable whenNotPaused {
        if (merchant == address(0) || treasury == address(0)) revert InvalidAddress();
        if (merchantAmountWei == 0 || feeAmountWei == 0)      revert InvalidAmounts();
        if (bytes(paymentRef).length == 0)                     revert MissingReference();

        uint256 required = merchantAmountWei + feeAmountWei;
        if (msg.value < required) revert InsufficientPayment(msg.value, required);

        (bool sentMerchant,) = merchant.call{value: merchantAmountWei}("");
        if (!sentMerchant) revert TransferFailed();

        (bool sentTreasury,) = treasury.call{value: feeAmountWei}("");
        if (!sentTreasury) revert TransferFailed();

        uint256 excess = msg.value - required;
        if (excess > 0) {
            (bool refunded,) = payable(msg.sender).call{value: excess}("");
            // Excess refund failure is non-fatal; payment already settled.
            if (!refunded) { /* accepted */ }
        }

        emit PaymentSplit(merchant, treasury, merchantAmountWei, feeAmountWei, paymentRef, msg.sender, address(0));
    }

    // ─────────────────────────────────────────────────────────────
    // ERC-20 split (e.g. USDC on Base: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)
    //
    // Caller must approve this contract for at least (merchantAmount + feeAmount)
    // on the token before calling splitToken.
    // ─────────────────────────────────────────────────────────────

    function splitToken(
        address payable merchant,
        address payable treasury,
        uint256 merchantAmount,
        uint256 feeAmount,
        string calldata paymentRef,
        address token
    ) external whenNotPaused {
        if (merchant == address(0) || treasury == address(0)) revert InvalidAddress();
        if (token == address(0))                               revert InvalidAddress();
        if (merchantAmount == 0 || feeAmount == 0)            revert InvalidAmounts();
        if (bytes(paymentRef).length == 0)                     revert MissingReference();

        IERC20 erc20 = IERC20(token);

        bool okMerchant = erc20.transferFrom(msg.sender, merchant, merchantAmount);
        if (!okMerchant) revert TransferFailed();

        bool okTreasury = erc20.transferFrom(msg.sender, treasury, feeAmount);
        if (!okTreasury) revert TransferFailed();

        emit PaymentSplit(merchant, treasury, merchantAmount, feeAmount, paymentRef, msg.sender, token);
    }

    // ─────────────────────────────────────────────────────────────
    // Admin
    // ─────────────────────────────────────────────────────────────

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        owner = newOwner;
    }

    receive() external payable {
        revert("Use split() or splitToken()");
    }
}
