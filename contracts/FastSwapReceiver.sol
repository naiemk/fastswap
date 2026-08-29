// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Receiver} from "onchain-invoice/contracts/Receiver.sol";
import {FastSwapExecutor} from "./executor/FastSwapExecutor.sol";

/**
 * @title FastSwapReceiver
 * @notice EVM invoice receiver + aggregator executor. Token hooks use SafeERC20.
 */
contract FastSwapReceiver is Receiver, FastSwapExecutor {
    using SafeERC20 for IERC20;

    receive() external payable {}

    function initialize(address initialOwner, uint16 feeBps_) public initializer {
        __Ownable_init(initialOwner);
        __FastSwapExecutor_init(initialOwner, feeBps_);
    }

    function _executeInvoice(
        bytes32 invoiceId,
        address token,
        uint256 amount,
        bytes calldata data
    ) internal override(Receiver) returns (bytes memory) {
        Receiver.InvoicePayment memory payment = this.invoicePayment(invoiceId);
        if (!payment.paid || payment.token != token || payment.amount != amount) revert InvalidPayment();
        return _executeFastSwapInvoice(invoiceId, token, amount, data);
    }

    function _transferToken(address token, address to, uint256 amount) internal override {
        IERC20(token).safeTransfer(to, amount);
    }

    function _approveToken(address token, address spender, uint256 amount) internal override {
        IERC20(token).forceApprove(spender, amount);
    }

    function _authorizeUpgrade(address newImplementation) internal override(Receiver) onlyRole(DEFAULT_ADMIN_ROLE) {}
}
