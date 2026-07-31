// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReceiverProxy} from "../../proxy/ReceiverProxy.sol";
import {TronLiquidityManager} from "./TronLiquidityManager.sol";

contract TronLiquidityManagerDeployer {
    event LiquidityManagerDeployed(address indexed manager, address indexed implementation);

    function deploy(address owner) external returns (address manager, address implementation) {
        implementation = address(new TronLiquidityManager());
        manager = address(
            new ReceiverProxy(
                implementation,
                abi.encodeWithSelector(bytes4(keccak256("initialize(address)")), owner)
            )
        );
        emit LiquidityManagerDeployed(manager, implementation);
    }
}
