// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AdapterContext} from "./AdapterContext.sol";

/**
 * @title IAggregatorAdapter
 * @notice One adapter per cross-chain aggregator (Rango, Rubic, Symbiosis, Transit).
 *         The executor approves tokens (or sends native value) then calls `execute`.
 */
interface IAggregatorAdapter {
    /// @dev keccak256("rango") etc. — human-readable provider id.
    function providerId() external view returns (bytes32);

    /// @dev Address of the FastSwap executor that may call this adapter.
    function executor() external view returns (address);

    /**
     * @notice Route `ctx.amount` of `ctx.token` through this provider.
     * @param ctx Execution pins (recipient, minOut, dest chain/token).
     * @param routeData Provider-specific payload (router target + calldata, etc.).
     */
    function execute(AdapterContext calldata ctx, bytes calldata routeData) external payable;
}
