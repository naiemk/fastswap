// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReceiverProxy as OciReceiverProxy} from "onchain-invoice/contracts/proxy/ReceiverProxy.sol";

contract ReceiverProxy is OciReceiverProxy {
    constructor(address implementation, bytes memory data) OciReceiverProxy(implementation, data) {}
}
