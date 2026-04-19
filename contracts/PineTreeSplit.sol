// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// PineTree Split Contract - Base + Ethereum
// Accepts ETH and atomically splits: merchantAmountWei to merchant, feeAmountWei to treasury.
// Deployed once per chain, handles all merchants. Owner can pause in emergencies.

contract PineTreeSplit {
    address public owner;
    bool public paused;

    event PaymentSplit(
        address indexed merchant,
        address indexed treasury,
        uint256 merchantAmount,
        uint256 feeAmount,
        string  paymentRef,
        address indexed payer
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
        if (msg.value < required) {
            revert InsufficientPayment(msg.value, required);
        }

        (bool sentMerchant, ) = merchant.call{value: merchantAmountWei}("");
        if (!sentMerchant) revert TransferFailed();

        (bool sentTreasury, ) = treasury.call{value: feeAmountWei}("");
        if (!sentTreasury) revert TransferFailed();

        uint256 excess = msg.value - required;
        if (excess > 0) {
            (bool refunded, ) = payable(msg.sender).call{value: excess}("");
            if (!refunded) {
                emit PaymentSplit(merchant, treasury, merchantAmountWei, feeAmountWei, paymentRef, msg.sender);
                return;
            }
        }

        emit PaymentSplit(merchant, treasury, merchantAmountWei, feeAmountWei, paymentRef, msg.sender);
    }

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
        revert("Use split()");
    }
}
