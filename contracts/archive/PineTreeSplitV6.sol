// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title PineTreeSplitV6
/// @notice Base split-payment contract for PineTree Payments — V6 (active).
/// @dev
/// Supports three atomic payment paths:
///
///   A. splitEth                  — customer sends one ETH transaction;
///                                  contract splits merchant amount + PineTree fee.
///
///   B. payUsdcWithAuthorization  — customer signs EIP-3009 ReceiveWithAuthorization
///                                  typed data; PineTree relayer submits the transaction;
///                                  compatible with MetaMask, Coinbase Wallet, etc.
///
///   C. payUsdcWithAllowance      — customer first approves this contract for the exact
///                                  total USDC amount (or the UI detects an existing
///                                  sufficient allowance and skips the approval);
///                                  customer then calls this function directly;
///                                  compatible with Trust Wallet and any wallet that
///                                  supports eth_sendTransaction.
///
/// PaymentSplit event shape is identical to PineTreeSplitV4 / V5 for full watcher compatibility.
/// PaymentRailUsed is emitted alongside PaymentSplit for analytics; it is never used by
/// the watcher for payment confirmation.

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IBaseUsdcEIP3009 {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

contract PineTreeSplitV6 {

    // ─────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────

    /// @notice Native USDC token address on Base mainnet.
    address public constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    // ─────────────────────────────────────────────────────────────
    // Storage
    // ─────────────────────────────────────────────────────────────

    /// @notice Contract owner. Can manage relayers, treasury, pause, and recover stuck funds.
    address public owner;

    /// @notice PineTree treasury wallet that receives PineTree fees on all payment paths.
    address payable public pineTreeTreasury;

    /// @notice Emergency pause flag. When true, all payment functions revert.
    bool public paused;

    /// @notice Owner-controlled allowlist of PineTree backend relayer addresses.
    ///         Only used by payUsdcWithAuthorization; not required for other paths.
    mapping(address => bool) public relayers;

    /// @notice On-chain replay guard keyed by keccak256(bytes(paymentRef)).
    ///         Applies to all three payment paths to prevent double-payment.
    mapping(bytes32 => bool) public usedPaymentRefs;

    /// @dev Reentrancy guard: 1 = not entered, 2 = entered.
    uint256 private _reentrancyStatus;

    // ─────────────────────────────────────────────────────────────
    // Structs — used by payUsdcWithAuthorization (relayer path)
    // ─────────────────────────────────────────────────────────────

    struct UsdcPayment {
        address payer;
        address payable merchant;
        address payable treasury;
        uint256 merchantAmount;
        uint256 feeAmount;
        string paymentRef;
    }

    struct Authorization {
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
    }

    struct Signature {
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    // ─────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────

    /// @notice Primary payment confirmation event.
    /// @dev Shape is identical to PineTreeSplitV4 / V5 PaymentSplit — the watcher reads
    ///      this event unchanged across all contract versions.
    ///      token = address(0) for ETH paths.
    ///      token = BASE_USDC for USDC paths.
    event PaymentSplit(
        address indexed merchant,
        address indexed treasury,
        uint256 merchantAmount,
        uint256 feeAmount,
        string paymentRef,
        address indexed payer,
        address token
    );

    /// @notice Analytics event emitted alongside every PaymentSplit.
    /// @dev Not used by the payment watcher. Decoded off-chain only.
    ///      rail = "ETH" | "USDC_AUTHORIZATION" | "USDC_ALLOWANCE"
    event PaymentRailUsed(string paymentRef, string rail);

    event RelayerUpdated(address indexed relayer, bool allowed);
    event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ERC20Recovered(address indexed token, address indexed to, uint256 amount);
    event ETHRecovered(address indexed to, uint256 amount);

    // ─────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────

    error InvalidAddress();
    error InvalidAmounts();
    error MissingReference();
    error PaymentReferenceAlreadyUsed(bytes32 paymentRefHash);
    error UnauthorizedRelayer();
    error InvalidTreasury();
    error ContractPaused();
    error OnlyOwner();
    error ReentrancyDetected();
    error InsufficientPayment(uint256 received, uint256 required);
    error TransferFailed();
    error ETHNotAccepted();

    // ─────────────────────────────────────────────────────────────
    // Modifiers
    // ─────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    modifier onlyRelayer() {
        if (!relayers[msg.sender]) revert UnauthorizedRelayer();
        _;
    }

    modifier nonReentrant() {
        if (_reentrancyStatus == 2) revert ReentrancyDetected();
        _reentrancyStatus = 2;
        _;
        _reentrancyStatus = 1;
    }

    // ─────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────

    /// @param initialTreasury PineTree treasury wallet that receives all PineTree fees.
    ///        Deployer is automatically allowlisted as the first relayer.
    constructor(address payable initialTreasury) {
        if (initialTreasury == address(0)) revert InvalidAddress();

        owner = msg.sender;
        pineTreeTreasury = initialTreasury;
        paused = false;
        _reentrancyStatus = 1;

        relayers[msg.sender] = true;

        emit OwnershipTransferred(address(0), msg.sender);
        emit TreasuryUpdated(address(0), initialTreasury);
        emit RelayerUpdated(msg.sender, true);
    }

    // ─────────────────────────────────────────────────────────────
    // Path A — Base ETH split
    // ─────────────────────────────────────────────────────────────

    /// @notice Splits an ETH payment between the merchant and PineTree treasury.
    /// @dev Customer sends one ETH transaction directly.
    ///      msg.value must be >= merchantAmountWei + feeAmountWei.
    ///      Any excess ETH is refunded to msg.sender.
    ///      treasury must equal pineTreeTreasury to prevent fee bypass via calldata.
    ///      usedPaymentRefs guards against on-chain replay for the same paymentRef.
    /// @param merchant   Merchant wallet that receives merchantAmountWei.
    /// @param treasury   Must equal pineTreeTreasury.
    /// @param merchantAmountWei  Merchant's share in wei.
    /// @param feeAmountWei       PineTree fee in wei.
    /// @param paymentRef         PineTree payment UUID.
    function splitEth(
        address payable merchant,
        address payable treasury,
        uint256 merchantAmountWei,
        uint256 feeAmountWei,
        string calldata paymentRef
    ) external payable whenNotPaused nonReentrant {
        if (merchant == address(0) || treasury == address(0)) revert InvalidAddress();
        if (treasury != pineTreeTreasury) revert InvalidTreasury();
        if (merchantAmountWei == 0 || feeAmountWei == 0) revert InvalidAmounts();
        if (bytes(paymentRef).length == 0) revert MissingReference();

        uint256 required = merchantAmountWei + feeAmountWei;
        if (msg.value < required) revert InsufficientPayment(msg.value, required);

        bytes32 refHash = keccak256(bytes(paymentRef));
        if (usedPaymentRefs[refHash]) revert PaymentReferenceAlreadyUsed(refHash);
        usedPaymentRefs[refHash] = true;

        (bool sentMerchant, ) = merchant.call{value: merchantAmountWei}("");
        if (!sentMerchant) revert TransferFailed();

        (bool sentTreasury, ) = pineTreeTreasury.call{value: feeAmountWei}("");
        if (!sentTreasury) revert TransferFailed();

        uint256 excess = msg.value - required;
        if (excess > 0) {
            (bool refunded, ) = payable(msg.sender).call{value: excess}("");
            if (!refunded) {
                // Non-fatal: payment already settled. Excess recoverable via recoverETH.
            }
        }

        emit PaymentSplit(
            merchant,
            pineTreeTreasury,
            merchantAmountWei,
            feeAmountWei,
            paymentRef,
            msg.sender,
            address(0)
        );
        emit PaymentRailUsed(paymentRef, "ETH");
    }

    // ─────────────────────────────────────────────────────────────
    // Path B — Base USDC EIP-3009 relayed split
    // ─────────────────────────────────────────────────────────────

    /// @notice Settles a Base USDC payment via EIP-3009 receiveWithAuthorization.
    /// @dev Called exclusively by an allowlisted PineTree relayer.
    ///      Customer signs ReceiveWithAuthorization typed data off-chain.
    ///      Relayer submits this transaction and pays Base gas.
    ///      Contract pulls authorized USDC into itself, then splits atomically.
    ///      Compatible with MetaMask, Coinbase Wallet, and wallets that support
    ///      eth_signTypedData_v4.
    function payUsdcWithAuthorization(
        UsdcPayment calldata payment,
        Authorization calldata authorization,
        Signature calldata signature
    ) external whenNotPaused nonReentrant onlyRelayer {
        _validateUsdcPayment(payment);

        bytes32 refHash = keccak256(bytes(payment.paymentRef));
        if (usedPaymentRefs[refHash]) revert PaymentReferenceAlreadyUsed(refHash);
        // CEI: mark used before external calls.
        usedPaymentRefs[refHash] = true;

        uint256 totalAmount = payment.merchantAmount + payment.feeAmount;

        uint256 received = _receiveAuthorizedUsdc(
            payment.payer,
            totalAmount,
            authorization,
            signature
        );

        if (received < totalAmount) revert InsufficientPayment(received, totalAmount);

        _transferUsdc(payment.merchant, payment.merchantAmount);
        _transferUsdc(pineTreeTreasury, payment.feeAmount);

        emit PaymentSplit(
            payment.merchant,
            pineTreeTreasury,
            payment.merchantAmount,
            payment.feeAmount,
            payment.paymentRef,
            payment.payer,
            BASE_USDC
        );
        emit PaymentRailUsed(payment.paymentRef, "USDC_AUTHORIZATION");
    }

    // ─────────────────────────────────────────────────────────────
    // Path C — Base USDC ERC-20 allowance split
    // ─────────────────────────────────────────────────────────────

    /// @notice Settles a Base USDC payment via standard ERC-20 approve + transferFrom.
    /// @dev Called directly by the customer wallet (msg.sender is the payer).
    ///      Customer must first call USDC.approve(address(this), merchantAmount + feeAmount).
    ///      If the customer's current USDC allowance is already sufficient, the app
    ///      skips the approve step and calls this function directly.
    ///      Compatible with Trust Wallet and any wallet that supports eth_sendTransaction.
    ///      treasury must equal pineTreeTreasury to prevent fee bypass via calldata.
    /// @param merchant       Merchant wallet.
    /// @param treasury       Must equal pineTreeTreasury.
    /// @param merchantAmount Merchant's USDC share (6-decimal atomic units).
    /// @param feeAmount      PineTree USDC fee (6-decimal atomic units).
    /// @param paymentRef     PineTree payment UUID.
    function payUsdcWithAllowance(
        address payable merchant,
        address payable treasury,
        uint256 merchantAmount,
        uint256 feeAmount,
        string calldata paymentRef
    ) external whenNotPaused nonReentrant {
        if (merchant == address(0) || treasury == address(0)) revert InvalidAddress();
        if (treasury != pineTreeTreasury) revert InvalidTreasury();
        if (merchantAmount == 0 || feeAmount == 0) revert InvalidAmounts();
        if (bytes(paymentRef).length == 0) revert MissingReference();

        uint256 totalAmount = merchantAmount + feeAmount;

        bytes32 refHash = keccak256(bytes(paymentRef));
        if (usedPaymentRefs[refHash]) revert PaymentReferenceAlreadyUsed(refHash);
        // CEI: mark used before transferFrom to prevent reentrancy-based replay.
        usedPaymentRefs[refHash] = true;

        bool pulled = IERC20(BASE_USDC).transferFrom(msg.sender, address(this), totalAmount);
        if (!pulled) revert TransferFailed();

        _transferUsdc(merchant, merchantAmount);
        _transferUsdc(pineTreeTreasury, feeAmount);

        emit PaymentSplit(
            merchant,
            pineTreeTreasury,
            merchantAmount,
            feeAmount,
            paymentRef,
            msg.sender,
            BASE_USDC
        );
        emit PaymentRailUsed(paymentRef, "USDC_ALLOWANCE");
    }

    // ─────────────────────────────────────────────────────────────
    // Owner controls
    // ─────────────────────────────────────────────────────────────

    /// @notice Adds or removes an allowlisted PineTree relayer.
    function setRelayer(address relayer, bool allowed) external onlyOwner {
        if (relayer == address(0)) revert InvalidAddress();
        relayers[relayer] = allowed;
        emit RelayerUpdated(relayer, allowed);
    }

    /// @notice Updates the PineTree treasury wallet.
    function setPineTreeTreasury(address payable newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert InvalidAddress();
        address previousTreasury = pineTreeTreasury;
        pineTreeTreasury = newTreasury;
        emit TreasuryUpdated(previousTreasury, newTreasury);
    }

    /// @notice Pauses all payment functions for emergencies.
    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    /// @notice Unpauses payment functions.
    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    /// @notice Transfers contract ownership to a new address.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    // ─────────────────────────────────────────────────────────────
    // Emergency recovery
    // ─────────────────────────────────────────────────────────────

    /// @notice Recovers ERC-20 tokens accidentally sent to this contract.
    function recoverERC20(address token, address to, uint256 amount)
        external
        onlyOwner
        nonReentrant
    {
        if (token == address(0) || to == address(0)) revert InvalidAddress();
        bool ok = IERC20(token).transfer(to, amount);
        if (!ok) revert TransferFailed();
        emit ERC20Recovered(token, to, amount);
    }

    /// @notice Recovers ETH accidentally held in this contract (e.g. failed excess refunds).
    function recoverETH(address payable to, uint256 amount)
        external
        onlyOwner
        nonReentrant
    {
        if (to == address(0)) revert InvalidAddress();
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit ETHRecovered(to, amount);
    }

    // ─────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────

    /// @notice Returns true if this paymentRef has already been settled on-chain.
    function isPaymentRefUsed(string calldata paymentRef) external view returns (bool) {
        return usedPaymentRefs[keccak256(bytes(paymentRef))];
    }

    // ─────────────────────────────────────────────────────────────
    // Internal helpers
    // ─────────────────────────────────────────────────────────────

    function _validateUsdcPayment(UsdcPayment calldata payment) internal view {
        if (
            payment.payer    == address(0) ||
            payment.merchant == address(0) ||
            payment.treasury == address(0)
        ) revert InvalidAddress();

        if (payment.treasury != pineTreeTreasury) revert InvalidTreasury();
        if (payment.merchantAmount == 0 || payment.feeAmount == 0) revert InvalidAmounts();
        if (bytes(payment.paymentRef).length == 0) revert MissingReference();

        uint256 total = payment.merchantAmount + payment.feeAmount;
        if (total == 0) revert InvalidAmounts();
    }

    function _receiveAuthorizedUsdc(
        address payer,
        uint256 totalAmount,
        Authorization calldata authorization,
        Signature calldata signature
    ) internal returns (uint256 received) {
        IERC20 usdc = IERC20(BASE_USDC);
        uint256 balanceBefore = usdc.balanceOf(address(this));

        IBaseUsdcEIP3009(BASE_USDC).receiveWithAuthorization(
            payer,
            address(this),
            totalAmount,
            authorization.validAfter,
            authorization.validBefore,
            authorization.nonce,
            signature.v,
            signature.r,
            signature.s
        );

        return usdc.balanceOf(address(this)) - balanceBefore;
    }

    function _transferUsdc(address to, uint256 amount) internal {
        bool ok = IERC20(BASE_USDC).transfer(to, amount);
        if (!ok) revert TransferFailed();
    }

    // ─────────────────────────────────────────────────────────────
    // ETH receive / fallback
    // ─────────────────────────────────────────────────────────────

    /// @dev Reject plain ETH transfers. splitEth() is the only valid ETH entry point.
    receive() external payable {
        revert ETHNotAccepted();
    }

    fallback() external payable {
        revert ETHNotAccepted();
    }
}
