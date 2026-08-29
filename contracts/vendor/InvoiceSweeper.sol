// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {InvoiceSweeper as OciInvoiceSweeper} from "onchain-invoice/contracts/InvoiceSweeper.sol";

contract InvoiceSweeper is OciInvoiceSweeper {
    constructor(address receiver_) OciInvoiceSweeper(receiver_) {}
}
