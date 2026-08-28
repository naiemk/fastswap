// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AdapterBase} from "./AdapterBase.sol";
import {AdapterContext} from "../executor/AdapterContext.sol";

/**
 * @title RangoAdapter
 * @notice Executes opaque router calldata from the Rango API.
 *         Trust: router must be allowlisted; relayer requests tx with from=executor and correct destination.
 * @dev routeData = abi.encode(address router, bytes callData)
 */
contract RangoAdapter is AdapterBase {
    constructor(address executor_) AdapterBase(executor_, keccak256("rango")) {}

    function execute(AdapterContext calldata ctx, bytes calldata routeData) external payable override onlyExecutor {
        (address router, bytes memory callData) = _decodeRouterCall(routeData);
        if (ctx.token == address(0)) {
            if (msg.value != ctx.amount) revert InvalidPayment();
            _callRouter(router, callData, ctx.amount);
        } else {
            _pullToken(ctx.token, ctx.amount);
            _approveRouter(ctx.token, router, ctx.amount);
            _callRouter(router, callData, 0);
        }
    }
}
