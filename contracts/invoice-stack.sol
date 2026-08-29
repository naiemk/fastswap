// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "onchain-invoice/contracts/Forwarder.sol";
import "onchain-invoice/contracts/InvoiceSweeper.sol";
import "onchain-invoice/contracts/proxy/ReceiverProxy.sol";
import "onchain-invoice/contracts/mocks/MockERC20.sol";

/**
 * @dev Ensures Hardhat emits deploy artifacts for the onchain-invoice stack used by FastSwap.
 */
contract InvoiceStackLinker {}
