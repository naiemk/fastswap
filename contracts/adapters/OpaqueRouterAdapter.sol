// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AdapterBase} from "./AdapterBase.sol";
import {AdapterContext} from "../executor/AdapterContext.sol";

/**
 * @title OpaqueRouterAdapter
 * @notice Generic allowlisted-router adapter for Rango, Rubic, Transit, Symbiosis, etc.
 * @dev routeData = abi.encode(address router, bytes callData)
 */
contract OpaqueRouterAdapter is AdapterBase {
    constructor(address executor_, bytes32 providerId_, address admin_, address[] memory routers_)
        AdapterBase(executor_, providerId_, admin_, routers_)
    {}

    function execute(AdapterContext calldata ctx, bytes calldata routeData) external payable override onlyExecutor {
        (address router, bytes memory callData) = _decodeRouterCall(routeData);
        if (ctx.token == address(0)) {
            if (msg.value != ctx.amount) revert InvalidPayment();
            _callRouter(router, callData, ctx.amount);
        } else {
            _pullToken(ctx.token, ctx.amount);
            _approveRouter(ctx.token, router, ctx.amount);
            _callRouter(router, callData, 0);
            _resetRouterAllowance(ctx.token, router);
        }
    }
}
