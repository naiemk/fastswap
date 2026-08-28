// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {AdapterBase} from "./AdapterBase.sol";
import {AdapterContext} from "../executor/AdapterContext.sol";

/**
 * @title MockAdapter
 * @notice Test adapter that forwards funds to a configured sink and records the last context.
 */
contract MockAdapter is AdapterBase {
    using SafeERC20 for IERC20;

    address public sink;
    AdapterContext public lastContext;
    bytes public lastRouteData;

    constructor(address executor_, address admin_, address sink_) AdapterBase(executor_, keccak256("mock"), admin_, new address[](0)) {
        sink = sink_;
    }

    function setSink(address sink_) external onlyExecutor {
        sink = sink_;
    }

    function execute(AdapterContext calldata ctx, bytes calldata routeData) external payable override onlyExecutor {
        lastContext = ctx;
        lastRouteData = routeData;

        (address router, bytes memory callData) = _decodeRouterCall(routeData);
        if (router != address(0)) {
            if (ctx.token == address(0)) {
                _callRouter(router, callData, ctx.amount);
            } else {
                _pullToken(ctx.token, ctx.amount);
                _approveRouter(ctx.token, router, ctx.amount);
                _callRouter(router, callData, 0);
            }
            return;
        }

        if (ctx.token == address(0)) {
            (bool ok,) = sink.call{value: ctx.amount}("");
            if (!ok) revert CallFailed();
        } else {
            _pullToken(ctx.token, ctx.amount);
            IERC20(ctx.token).safeTransfer(sink, ctx.amount);
        }
    }
}
