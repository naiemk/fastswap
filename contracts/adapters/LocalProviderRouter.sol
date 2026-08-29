// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title LocalProviderRouter
 * @notice Source-chain Router for the Local Provider. Execute ends here (ADR-0001).
 */
contract LocalProviderRouter {
    event Accepted(address indexed from, uint256 amount);

    receive() external payable {
        emit Accepted(msg.sender, msg.value);
    }
}
