// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockERC20 as OciMockERC20} from "onchain-invoice/contracts/mocks/MockERC20.sol";

contract MockERC20 is OciMockERC20 {
    constructor(string memory name_, string memory symbol_, uint8 decimals_) OciMockERC20(name_, symbol_, decimals_) {}
}
