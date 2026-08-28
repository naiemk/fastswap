// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAggregatorAdapter} from "../executor/IAggregatorAdapter.sol";
import {AdapterContext} from "../executor/AdapterContext.sol";

/**
 * @title AdapterBase
 * @notice Shared helpers: only the executor may call, exact-amount ERC20 pull, router allowlist.
 */
abstract contract AdapterBase is IAggregatorAdapter {
    using SafeERC20 for IERC20;

    address public immutable EXECUTOR;
    address public immutable ADMIN;
    bytes32 public immutable PROVIDER_ID;

    mapping(address router => bool allowed) public routerAllowed;

    event RouterAllowedSet(address indexed router, bool allowed);

    error Unauthorized();
    error RouterNotAllowed();
    error InvalidPayment();
    error CallFailed();

    constructor(address executor_, bytes32 providerId_, address admin_, address[] memory routers_) {
        if (executor_ == address(0) || admin_ == address(0)) revert InvalidPayment();
        EXECUTOR = executor_;
        ADMIN = admin_;
        PROVIDER_ID = providerId_;
        for (uint256 i; i < routers_.length;) {
            routerAllowed[routers_[i]] = true;
            emit RouterAllowedSet(routers_[i], true);
            unchecked {
                ++i;
            }
        }
    }

    function providerId() external view returns (bytes32) {
        return PROVIDER_ID;
    }

    function executor() external view returns (address) {
        return EXECUTOR;
    }

    function setRouterAllowed(address router, bool allowed) external {
        if (msg.sender != ADMIN) revert Unauthorized();
        routerAllowed[router] = allowed;
        emit RouterAllowedSet(router, allowed);
    }

    modifier onlyExecutor() {
        if (msg.sender != EXECUTOR) revert Unauthorized();
        _;
    }

    function _pullToken(address token, uint256 amount) internal {
        IERC20(token).safeTransferFrom(EXECUTOR, address(this), amount);
    }

    function _approveRouter(address token, address router, uint256 amount) internal {
        if (token == address(0)) return;
        IERC20(token).forceApprove(router, amount);
    }

    function _callRouter(address router, bytes memory callData, uint256 value) internal {
        if (!routerAllowed[router]) revert RouterNotAllowed();
        (bool ok,) = router.call{value: value}(callData);
        if (!ok) revert CallFailed();
    }

    /// @dev routeData = abi.encode(address router, bytes callData)
    function _decodeRouterCall(bytes calldata routeData) internal pure returns (address router, bytes memory callData) {
        (router, callData) = abi.decode(routeData, (address, bytes));
    }

    function execute(AdapterContext calldata ctx, bytes calldata routeData) external payable virtual override;
}
