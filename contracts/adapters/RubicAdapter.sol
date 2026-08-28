// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AdapterBase} from "./AdapterBase.sol";
import {AdapterContext} from "../executor/AdapterContext.sol";

/**
 * @title RubicAdapter
 * @notice Same opaque-router pattern as Rango. Deposit-address routes are rejected off-chain.
 * @dev routeData = abi.encode(address router, bytes callData)
 */
contract RubicAdapter is AdapterBase {
    constructor(address executor_, address admin_) AdapterBase(executor_, keccak256("rubic"), admin_, new address[](0)) {}

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
