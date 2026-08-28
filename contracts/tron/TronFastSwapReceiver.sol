// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TronReceiver} from "onchain-invoice/contracts/tron/TronReceiver.sol";
import {FastSwapExecutor} from "../executor/FastSwapExecutor.sol";
import {ITrc20} from "onchain-invoice/contracts/tron/interfaces/ITrc20.sol";

/**
 * @title TronFastSwapReceiver
 * @notice TRON invoice receiver + aggregator executor with low-level TRC20 calls.
 */
contract TronFastSwapReceiver is TronReceiver, FastSwapExecutor {
    receive() external payable {}

    function initialize(address initialOwner) public override(TronReceiver) initializer {
        __Ownable_init(initialOwner);
        __FastSwapExecutor_init(initialOwner, 75);
    }

    function _executeInvoice(
        bytes32 invoiceId,
        address token,
        uint256 amount,
        bytes calldata data
    ) internal override(TronReceiver) returns (bytes memory) {
        TronReceiver.InvoicePayment memory payment = this.invoicePayment(invoiceId);
        if (!payment.paid || payment.token != token || payment.amount != amount) revert InvalidPayment();
        return _executeFastSwapInvoice(invoiceId, token, amount, data);
    }

    function _transferToken(address token, address to, uint256 amount) internal override {
        _trc20Transfer(token, to, amount);
    }

    function _approveToken(address token, address spender, uint256 amount) internal override {
        _trc20Approve(token, spender, amount);
    }

    function _trc20Transfer(address token, address to, uint256 amount) private {
        (bool ok,) = token.call(abi.encodeWithSelector(ITrc20.transfer.selector, to, amount));
        if (!ok) revert InvalidPayment();
    }

    function _trc20Approve(address token, address spender, uint256 amount) private {
        (bool ok,) = token.call(abi.encodeWithSignature("approve(address,uint256)", spender, amount));
        if (!ok) revert InvalidPayment();
    }

    function _authorizeUpgrade(address newImplementation) internal override(TronReceiver) onlyRole(DEFAULT_ADMIN_ROLE) {}
}
