// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @title PineTreeSplitV4
/// @notice Base USDC EIP-3009 relayed split-payment contract for PineTree Payments.
/// @dev
/// V4 is designed for a PineTree backend relayer/facilitator:
/// - Customer signs native Base USDC receiveWithAuthorization typed data.
/// - PineTree relayer submits this contract call and pays Base gas.
/// - Contract pulls authorized USDC into itself, then atomically splits merchant amount and PineTree fee.
/// - Deployer is automatically allowlisted as the first relayer.
/// - PineTree treasury is enforced on-chain so fee cannot be redirected by bad calldata.
interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
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

contract PineTreeSplitV4 {
    // ─────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────

    /// @notice Native USDC token on Base mainnet.
    address public constant BASE_USDC =
        0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    // ─────────────────────────────────────────────────────────────
    // Storage
    // ─────────────────────────────────────────────────────────────

    /// @notice Contract owner. Can pause, manage relayers, recover stuck funds, and transfer ownership.
    address public owner;

    /// @notice PineTree treasury wallet that receives PineTree USDC fees.
    address payable public pineTreeTreasury;

    /// @notice Emergency pause flag.
    bool public paused;

    /// @notice Owner-controlled allowlist of PineTree backend relayers.
    mapping(address => bool) public relayers;

    /// @notice On-chain replay/idempotency guard keyed by keccak256(bytes(paymentRef)).
    mapping(bytes32 => bool) public usedPaymentRefs;

    /// @dev Reentrancy guard status. 1 = not entered, 2 = entered.
    uint256 private _reentrancyStatus;

    // ─────────────────────────────────────────────────────────────
    // Structs
    // ─────────────────────────────────────────────────────────────

    /// @notice PineTree DB-backed split details submitted by an allowlisted relayer.
    struct UsdcPayment {
        address payer;
        address payable merchant;
        address payable treasury;
        uint256 merchantAmount;
        uint256 feeAmount;
        string paymentRef;
    }

    /// @notice EIP-3009 authorization validity and nonce fields.
    struct Authorization {
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
    }

    /// @notice secp256k1 signature components for USDC receiveWithAuthorization.
    struct Signature {
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    // ─────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────

    /// @notice Watcher-compatible V1 event declaration. Do not reorder fields.
    /// @dev token is address(0) for ETH and BASE_USDC for Base USDC.
    event PaymentSplit(
        address indexed merchant,
        address indexed treasury,
        uint256 merchantAmount,
        uint256 feeAmount,
        string paymentRef,
        address indexed payer,
        address token
    );

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

    /// @notice Deploys V4 and automatically allowlists the deployer as the first PineTree relayer.
    /// @param initialTreasury PineTree treasury wallet that receives PineTree USDC fees.
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
    // Base USDC EIP-3009 relayed split
    // ─────────────────────────────────────────────────────────────

    /// @notice Settles a Base USDC payment by consuming an EIP-3009 authorization and splitting funds.
    /// @dev
    /// Customer-signed EIP-3009 authorization must be for:
    /// - from: payment.payer
    /// - to: address(this)
    /// - value: payment.merchantAmount + payment.feeAmount
    /// - validAfter/validBefore/nonce: authorization fields
    ///
    /// EIP-3009 itself binds payer, this contract, total amount, validity, and nonce.
    /// PineTree backend relayers validate merchant, amount, fee, and paymentRef from the PineTree DB.
    /// This contract additionally enforces:
    /// - allowlisted relayer only
    /// - non-empty paymentRef
    /// - one settlement per paymentRef
    /// - treasury must equal pineTreeTreasury
    function payWithUsdcAuthorization(
        UsdcPayment calldata payment,
        Authorization calldata authorization,
        Signature calldata signature
    ) external whenNotPaused nonReentrant onlyRelayer {
        _validateUsdcPayment(payment);

        uint256 totalAmount = payment.merchantAmount + payment.feeAmount;
        bytes32 paymentRefHash = keccak256(bytes(payment.paymentRef));

        if (usedPaymentRefs[paymentRefHash]) {
            revert PaymentReferenceAlreadyUsed(paymentRefHash);
        }

        // Mark used before external calls to prevent reentrancy/replay around the USDC pull and transfers.
        usedPaymentRefs[paymentRefHash] = true;

        uint256 received = _receiveAuthorizedUsdc(
            payment.payer,
            totalAmount,
            authorization,
            signature
        );

        if (received < totalAmount) {
            revert InsufficientPayment(received, totalAmount);
        }

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
    }

    // ─────────────────────────────────────────────────────────────
    // Optional ETH split compatibility
    // ─────────────────────────────────────────────────────────────

    /// @notice ETH split function kept compatible with the current PineTreeSplit event shape.
    /// @dev Included for contract compatibility only. App Base ETH logic does not need to change.
    function split(
        address payable merchant,
        address payable treasury,
        uint256 merchantAmountWei,
        uint256 feeAmountWei,
        string calldata paymentRef
    ) external payable whenNotPaused nonReentrant {
        if (merchant == address(0) || treasury == address(0)) revert InvalidAddress();
        if (merchantAmountWei == 0 || feeAmountWei == 0) revert InvalidAmounts();
        if (bytes(paymentRef).length == 0) revert MissingReference();

        uint256 required = merchantAmountWei + feeAmountWei;
        if (msg.value < required) revert InsufficientPayment(msg.value, required);

        (bool sentMerchant, ) = merchant.call{value: merchantAmountWei}("");
        if (!sentMerchant) revert TransferFailed();

        (bool sentTreasury, ) = treasury.call{value: feeAmountWei}("");
        if (!sentTreasury) revert TransferFailed();

        uint256 excess = msg.value - required;
        if (excess > 0) {
            (bool refunded, ) = payable(msg.sender).call{value: excess}("");
            if (!refunded) {
                // Excess refund failure is non-fatal; payment already settled.
            }
        }

        emit PaymentSplit(
            merchant,
            treasury,
            merchantAmountWei,
            feeAmountWei,
            paymentRef,
            msg.sender,
            address(0)
        );
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

    /// @notice Pauses payment functions for emergencies.
    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    /// @notice Unpauses payment functions.
    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    /// @notice Transfers contract ownership.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();

        address previousOwner = owner;
        owner = newOwner;

        emit OwnershipTransferred(previousOwner, newOwner);
    }

    // ─────────────────────────────────────────────────────────────
    // Emergency recovery
    // ─────────────────────────────────────────────────────────────

    /// @notice Recovers ERC-20 tokens accidentally left in the contract.
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

    /// @notice Recovers ETH accidentally left in the contract.
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

    function isPaymentRefUsed(string calldata paymentRef) external view returns (bool) {
        return usedPaymentRefs[keccak256(bytes(paymentRef))];
    }

    // ─────────────────────────────────────────────────────────────
    // Internal validation
    // ─────────────────────────────────────────────────────────────

    function _validateUsdcPayment(UsdcPayment calldata payment) internal view {
        if (
            payment.payer == address(0) ||
            payment.merchant == address(0) ||
            payment.treasury == address(0)
        ) {
            revert InvalidAddress();
        }

        if (payment.treasury != pineTreeTreasury) {
            revert InvalidTreasury();
        }

        if (payment.merchantAmount == 0 || payment.feeAmount == 0) {
            revert InvalidAmounts();
        }

        if (bytes(payment.paymentRef).length == 0) {
            revert MissingReference();
        }

        // Solidity 0.8.x overflow checks enforce totalAmount validity.
        uint256 totalAmount = payment.merchantAmount + payment.feeAmount;
        if (totalAmount == 0) revert InvalidAmounts();
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
    // ETH receive/fallback
    // ─────────────────────────────────────────────────────────────

    receive() external payable {
        revert ETHNotAccepted();
    }

    fallback() external payable {
        revert ETHNotAccepted();
    }
}