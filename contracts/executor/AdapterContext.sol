// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title AdapterContext
 * @notice Immutable execution pins passed from the executor to every aggregator adapter.
 *         Adapters must enforce recipient and minAmountOut where the provider ABI allows.
 */
struct AdapterContext {
    bytes32 invoiceId;
    address token;
    uint256 amount;
    uint256 destChainId;
    bytes destToken;
    bytes recipient;
    uint256 minAmountOut;
    address refundTo;
}
