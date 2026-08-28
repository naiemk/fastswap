// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AdapterBase} from "./AdapterBase.sol";
import {AdapterContext} from "../executor/AdapterContext.sol";

/**
 * @title SymbiosisAdapter
 * @notice Calls Symbiosis MetaRouter.metaRoute. Pins destination `to` against ctx.recipient.
 * @dev routeData = abi.encode(address metaRouter, bytes metaRouteCalldata)
 *      metaRouteCalldata must encode MetaRouteTransaction where field `to` matches ctx.recipient (20 bytes).
 */
contract SymbiosisAdapter is AdapterBase {
    constructor(address executor_, address admin_) AdapterBase(executor_, keccak256("symbiosis"), admin_, new address[](0)) {}

    function execute(AdapterContext calldata ctx, bytes calldata routeData) external payable override onlyExecutor {
        (address router, bytes memory callData) = _decodeRouterCall(routeData);
        _requireRecipientPinned(callData, ctx.recipient);

        if (ctx.token == address(0)) {
            if (msg.value != ctx.amount) revert InvalidPayment();
            _callRouter(router, callData, ctx.amount);
        } else {
            _pullToken(ctx.token, ctx.amount);
            _approveRouter(ctx.token, router, ctx.amount);
            _callRouter(router, callData, 0);
        }
    }

    /// @dev metaRoute calldata: selector + MetaRouteTransaction; `to` is at word offset 6 in the tuple (bytes 192-223 after selector).
    function _requireRecipientPinned(bytes memory callData, bytes memory recipient) internal pure {
        if (recipient.length != 20) revert InvalidPayment();
        if (callData.length < 4 + 32 * 7) revert InvalidPayment();

        bytes20 expected;
        assembly {
            expected := mload(add(recipient, 32))
        }

        bytes20 actual;
        assembly {
            actual := mload(add(add(callData, 36), 160))
        }
        if (expected != actual) revert InvalidPayment();
    }
}
