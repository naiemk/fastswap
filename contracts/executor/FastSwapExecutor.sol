// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAggregatorAdapter} from "./IAggregatorAdapter.sol";
import {AdapterContext} from "./AdapterContext.sol";

/**
 * @title FastSwapExecutor
 * @notice Invoice state machine for aggregator-of-aggregators swaps.
 *         Users pay via onchain-invoice forwarders; relayer calls `execute` on source chain.
 *         No inventory, no dest-chain payout — aggregators deliver cross-chain.
 */
abstract contract FastSwapExecutor is AccessControlUpgradeable, EIP712Upgradeable, PausableUpgradeable {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    uint8 public constant INTENT_VERSION = 2;
    uint16 public constant MAX_FEE_BPS = 100;

    bytes32 private constant EXECUTE_PLAN_TYPEHASH =
        keccak256("ExecutePlan(bytes32 invoiceId,bytes32 adapterId,bytes32 routeDataHash,uint256 minAmountOut)");

    enum InvoiceStatus {
        None,
        Paid,
        Executed,
        Refunded
    }

    struct SwapIntent {
        uint8 version;
        bytes32 quoteId;
        uint256 sourceChainId;
        bytes sourceToken;
        uint256 minSourceAmount;
        uint256 destChainId;
        bytes destToken;
        uint256 minAmountOut;
        bytes recipient;
        bytes refundTo;
        uint64 expiresAt;
        uint16 slippageBps;
    }

    struct InvoiceRecord {
        InvoiceStatus status;
        address paidToken;
        uint256 paidAmount;
        uint16 invoiceFeeBps;
        uint64 expiresAt;
        address refundTo;
        uint256 minAmountOut;
        bytes32 destPins;
        bytes32 executedAdapterId;
    }

    /// @custom:storage-location erc7201:fastswap.storage.FastSwapExecutor
    struct FastSwapStorage {
        mapping(bytes32 invoiceId => InvoiceRecord record) invoices;
        mapping(bytes32 adapterId => address adapter) adapters;
        mapping(address token => uint256 amount) reserved;
        uint16 feeBps;
        address treasury;
        uint256 reentrancyStatus;
    }

    // keccak256(abi.encode(uint256(keccak256("fastswap.storage.FastSwapExecutor")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant FASTSWAP_STORAGE_LOCATION =
        0xc202e599bf00194ddf9a023608d5682d137afb9d4cebab16a72746b2881aff01;

    event SwapExecuted(
        bytes32 indexed invoiceId,
        bytes32 indexed adapterId,
        address indexed token,
        uint256 amountIn,
        uint256 minAmountOut
    );
    event InvoiceRefunded(bytes32 indexed invoiceId, address indexed token, address indexed to, uint256 amount);
    event AdapterSet(bytes32 indexed adapterId, address indexed adapter);
    event FeeBpsSet(uint16 feeBps);
    event TreasurySet(address indexed treasury);

    error InvalidIntent();
    error InvalidPayment();
    error InvalidRecipient();
    error InvalidAdapter();
    error InvalidState();
    error InvalidFee();
    error ReentrantCall();
    error InvalidSignature();
    error Expired();
    error TokenMismatch();
    error TransferFailed();

    modifier nonReentrant() {
        FastSwapStorage storage $ = _getFastSwapStorage();
        if ($.reentrancyStatus == _ENTERED) revert ReentrantCall();
        $.reentrancyStatus = _ENTERED;
        _;
        $.reentrancyStatus = _NOT_ENTERED;
    }

    // --- chain-specific token primitives ---

    function _transferToken(address token, address to, uint256 amount) internal virtual;
    function _approveToken(address token, address spender, uint256 amount) internal virtual;

    function __FastSwapExecutor_init(address owner, uint16 feeBps_) internal onlyInitializing {
        __AccessControl_init();
        __EIP712_init("FastSwap", "1");
        __Pausable_init();
        FastSwapStorage storage $ = _getFastSwapStorage();
        $.reentrancyStatus = _NOT_ENTERED;
        $.feeBps = feeBps_;
        _grantRole(DEFAULT_ADMIN_ROLE, owner);
        _grantRole(ADMIN_ROLE, owner);
        _grantRole(SIGNER_ROLE, owner);
        _grantRole(PAUSER_ROLE, owner);
    }

    // --- views ---

    function invoiceRecord(bytes32 invoiceId) external view returns (InvoiceRecord memory) {
        return _getFastSwapStorage().invoices[invoiceId];
    }

    function invoiceStatus(bytes32 invoiceId) external view returns (uint8 status, address token, uint256 amount) {
        InvoiceRecord storage record = _getFastSwapStorage().invoices[invoiceId];
        return (uint8(record.status), record.paidToken, record.paidAmount);
    }

    function adapter(bytes32 adapterId) external view returns (address) {
        return _getFastSwapStorage().adapters[adapterId];
    }

    function feeBps() external view returns (uint16) {
        return _getFastSwapStorage().feeBps;
    }

    function treasury() external view returns (address) {
        return _getFastSwapStorage().treasury;
    }

    // --- admin ---

    function setAdapter(bytes32 adapterId, address adapterAddr) external onlyRole(ADMIN_ROLE) {
        _getFastSwapStorage().adapters[adapterId] = adapterAddr;
        emit AdapterSet(adapterId, adapterAddr);
    }

    function setFeeBps(uint16 feeBps_) external onlyRole(ADMIN_ROLE) {
        if (feeBps_ > MAX_FEE_BPS) revert InvalidFee();
        _getFastSwapStorage().feeBps = feeBps_;
        emit FeeBpsSet(feeBps_);
    }

    function setTreasury(address treasury_) external onlyRole(ADMIN_ROLE) {
        if (treasury_ == address(0)) revert InvalidRecipient();
        _getFastSwapStorage().treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // --- relayer ---

    function execute(
        bytes32 invoiceId,
        bytes32 adapterId,
        bytes calldata routeData,
        uint256 destChainId,
        bytes calldata destToken,
        bytes calldata recipient,
        bytes calldata signature
    ) external onlyRole(RELAYER_ROLE) whenNotPaused nonReentrant {
        FastSwapStorage storage $ = _getFastSwapStorage();
        InvoiceRecord storage record = $.invoices[invoiceId];
        if (record.status != InvoiceStatus.Paid) revert InvalidState();
        if (block.timestamp > uint256(record.expiresAt) + 1 hours) revert Expired();
        if (keccak256(abi.encode(destChainId, destToken, recipient)) != record.destPins) revert InvalidIntent();

        address adapterAddr = $.adapters[adapterId];
        if (adapterAddr == address(0)) revert InvalidAdapter();
        if (IAggregatorAdapter(adapterAddr).providerId() != adapterId) revert InvalidAdapter();

        uint256 floor = record.minAmountOut;
        _verifyExecutePlan(invoiceId, adapterId, keccak256(routeData), floor, signature);

        uint256 fee = (record.paidAmount * record.invoiceFeeBps) / 10_000;
        uint256 routeAmount = record.paidAmount - fee;
        if (routeAmount == 0) revert InvalidPayment();

        address token = record.paidToken;
        address treasuryAddr = $.treasury;
        if (fee > 0) {
            if (treasuryAddr == address(0)) revert InvalidRecipient();
            _transferOut(token, treasuryAddr, fee);
        }

        AdapterContext memory ctx = AdapterContext({
            invoiceId: invoiceId,
            token: token,
            amount: routeAmount,
            destChainId: destChainId,
            destToken: destToken,
            recipient: recipient,
            minAmountOut: floor,
            refundTo: record.refundTo
        });

        if (token == address(0)) {
            IAggregatorAdapter(adapterAddr).execute{value: routeAmount}(ctx, routeData);
        } else {
            _approveToken(token, adapterAddr, routeAmount);
            IAggregatorAdapter(adapterAddr).execute(ctx, routeData);
        }

        record.status = InvoiceStatus.Executed;
        record.executedAdapterId = adapterId;
        $.reserved[token] -= record.paidAmount;
        if (token != address(0)) {
            _approveToken(token, adapterAddr, 0);
        }
        emit SwapExecuted(invoiceId, adapterId, token, routeAmount, floor);
    }

    function refund(bytes32 invoiceId) external nonReentrant {
        FastSwapStorage storage $ = _getFastSwapStorage();
        InvoiceRecord storage record = $.invoices[invoiceId];
        if (record.status != InvoiceStatus.Paid) revert InvalidState();
        if (block.timestamp <= record.expiresAt && !hasRole(RELAYER_ROLE, msg.sender)) {
            revert InvalidState();
        }

        address to = record.refundTo;
        if (to == address(0)) revert InvalidRecipient();

        uint256 amount = record.paidAmount;
        address token = record.paidToken;
        record.status = InvoiceStatus.Refunded;
        record.paidAmount = 0;
        $.reserved[token] -= amount;

        _transferOut(token, to, amount);
        emit InvoiceRefunded(invoiceId, token, to, amount);
    }

    function rescue(address token, address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (to == address(0)) revert InvalidRecipient();
        FastSwapStorage storage $ = _getFastSwapStorage();
        uint256 balance = token == address(0) ? address(this).balance : IERC20(token).balanceOf(address(this));
        if (amount > balance - $.reserved[token]) revert InvalidPayment();
        _transferOut(token, to, amount);
    }

    // --- invoice hook ---

    function _executeFastSwapInvoice(
        bytes32 invoiceId,
        address token,
        uint256 amount,
        bytes calldata data
    ) internal whenNotPaused nonReentrant returns (bytes memory) {
        SwapIntent memory intent = _decodeIntent(data);
        if (intent.sourceChainId != block.chainid) revert InvalidPayment();
        if (!_tokenMatches(intent.sourceToken, token)) revert TokenMismatch();
        if (amount < intent.minSourceAmount) revert InvalidPayment();
        if (block.timestamp > intent.expiresAt) revert Expired();

        FastSwapStorage storage $ = _getFastSwapStorage();
        InvoiceRecord storage record = $.invoices[invoiceId];
        if (record.status != InvoiceStatus.None) revert InvalidState();

        record.status = InvoiceStatus.Paid;
        record.paidToken = token;
        record.paidAmount = amount;
        record.invoiceFeeBps = $.feeBps;
        record.expiresAt = intent.expiresAt;
        record.refundTo = _decodeRefundAddress(intent.refundTo);
        record.minAmountOut = intent.minAmountOut;
        record.destPins = keccak256(abi.encode(intent.destChainId, intent.destToken, intent.recipient));
        $.reserved[token] += amount;

        return "";
    }

    // --- internal ---

    function _decodeIntent(bytes calldata data) private pure returns (SwapIntent memory intent) {
        intent = abi.decode(data, (SwapIntent));
        if (intent.version != INTENT_VERSION || intent.expiresAt == 0 || intent.recipient.length == 0) {
            revert InvalidIntent();
        }
        if (intent.refundTo.length != 20) revert InvalidRecipient();
    }

    function _tokenMatches(bytes memory intentToken, address token) private pure returns (bool) {
        if (token == address(0)) {
            return intentToken.length == 0;
        }
        if (intentToken.length != 20) return false;
        address decoded;
        assembly {
            decoded := shr(96, mload(add(intentToken, 32)))
        }
        return decoded == token;
    }

    function _decodeRefundAddress(bytes memory refundTo) private pure returns (address) {
        if (refundTo.length == 0) return address(0);
        if (refundTo.length != 20) revert InvalidRecipient();
        address decoded;
        assembly {
            decoded := shr(96, mload(add(refundTo, 32)))
        }
        return decoded;
    }

    function _verifyExecutePlan(
        bytes32 invoiceId,
        bytes32 adapterId,
        bytes32 routeDataHash,
        uint256 minAmountOut,
        bytes calldata signature
    ) private view {
        bytes32 structHash = keccak256(abi.encode(EXECUTE_PLAN_TYPEHASH, invoiceId, adapterId, routeDataHash, minAmountOut));
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = _recoverSigner(digest, signature);
        if (!hasRole(SIGNER_ROLE, signer)) revert InvalidSignature();
    }

    function _recoverSigner(bytes32 digest, bytes calldata signature) private pure returns (address signer) {
        if (signature.length != 65) revert InvalidSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) {
            v += 27;
        }
        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
    }

    function _transferOut(address token, address to, uint256 amount) private {
        if (token == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            _transferToken(token, to, amount);
        }
    }

    function _getFastSwapStorage() private pure returns (FastSwapStorage storage $) {
        assembly {
            $.slot := FASTSWAP_STORAGE_LOCATION
        }
    }
}
