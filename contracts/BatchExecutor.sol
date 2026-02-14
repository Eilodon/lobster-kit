// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title BatchExecutor
 * @dev Execute multiple transactions in a single call to save gas.
 *
 * FIX F2: Added authorizedExecutors mapping — only owner or authorized
 *         addresses can call batch functions. No more open proxy.
 * FIX H3: Replaced transfer() with call{value:}() for AA wallet compat.
 */
contract BatchExecutor is Ownable, ReentrancyGuard {
    // ═══════════════════════════════════════════════════════
    //  ACCESS CONTROL (FIX F2)
    // ═══════════════════════════════════════════════════════

    mapping(address => bool) public authorizedExecutors;

    modifier onlyAuthorized() {
        require(
            msg.sender == owner() || authorizedExecutors[msg.sender],
            "Not authorized"
        );
        _;
    }

    // ═══════════════════════════════════════════════════════
    //  EVENTS
    // ═══════════════════════════════════════════════════════

    event BatchExecuted(address indexed executor, uint256 txCount, bool[] success);
    event SingleExecuted(address indexed executor, address target, bool success);
    event ExecutorAuthorized(address indexed executor);
    event ExecutorRevoked(address indexed executor);

    constructor() Ownable(msg.sender) {}

    // ═══════════════════════════════════════════════════════
    //  EXECUTOR MANAGEMENT
    // ═══════════════════════════════════════════════════════

    function authorizeExecutor(address executor) external onlyOwner {
        require(executor != address(0), "Invalid executor");
        authorizedExecutors[executor] = true;
        emit ExecutorAuthorized(executor);
    }

    function revokeExecutor(address executor) external onlyOwner {
        authorizedExecutors[executor] = false;
        emit ExecutorRevoked(executor);
    }

    // ═══════════════════════════════════════════════════════
    //  BATCH EXECUTION (strict — revert all on failure)
    // ═══════════════════════════════════════════════════════

    /**
     * @dev Execute batch — reverts entirely if ANY call fails
     */
    function executeBatch(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata datas
    ) external payable onlyAuthorized nonReentrant returns (bytes[] memory results) {
        require(targets.length == values.length && values.length == datas.length, "Length mismatch");
        require(targets.length > 0 && targets.length <= 50, "Batch: 1-50");

        results = new bytes[](targets.length);

        for (uint256 i = 0; i < targets.length; i++) {
            require(targets[i] != address(0), "Invalid target");
            (bool success, bytes memory result) = targets[i].call{value: values[i]}(datas[i]);
            require(success, string(abi.encodePacked("Call failed at index ", _toString(i))));
            results[i] = result;
        }

        // FIX H3: Refund excess ETH using call instead of transfer
        uint256 remaining = address(this).balance;
        if (remaining > 0) {
            (bool refundSuccess, ) = payable(msg.sender).call{value: remaining}("");
            require(refundSuccess, "Refund failed");
        }

        bool[] memory allSuccess = new bool[](targets.length);
        for (uint256 i = 0; i < targets.length; i++) {
            allSuccess[i] = true;
        }
        emit BatchExecuted(msg.sender, targets.length, allSuccess);
    }

    // ═══════════════════════════════════════════════════════
    //  BATCH EXECUTION (tolerant — continue on failure)
    // ═══════════════════════════════════════════════════════

    /**
     * @dev Execute batch tolerant — continues even if individual calls fail
     */
    function executeBatchTolerant(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata datas
    ) external payable onlyAuthorized nonReentrant returns (bool[] memory success, bytes[] memory results) {
        require(targets.length == values.length && values.length == datas.length, "Length mismatch");
        require(targets.length > 0 && targets.length <= 50, "Batch: 1-50");

        success = new bool[](targets.length);
        results = new bytes[](targets.length);

        for (uint256 i = 0; i < targets.length; i++) {
            if (targets[i] == address(0)) {
                success[i] = false;
                continue;
            }
            (success[i], results[i]) = targets[i].call{value: values[i]}(datas[i]);
        }

        // FIX H3: Refund excess ETH using call instead of transfer
        uint256 remaining = address(this).balance;
        if (remaining > 0) {
            (bool refundSuccess, ) = payable(msg.sender).call{value: remaining}("");
            require(refundSuccess, "Refund failed");
        }

        emit BatchExecuted(msg.sender, targets.length, success);
    }

    // ═══════════════════════════════════════════════════════
    //  SINGLE EXECUTION
    // ═══════════════════════════════════════════════════════

    /**
     * @dev Execute single call
     */
    function executeSingle(
        address target,
        uint256 value,
        bytes calldata data
    ) external payable onlyAuthorized nonReentrant returns (bool success, bytes memory result) {
        require(target != address(0), "Invalid target");
        (success, result) = target.call{value: value}(data);
        emit SingleExecuted(msg.sender, target, success);

        // FIX H3: Refund excess ETH using call instead of transfer
        uint256 remaining = address(this).balance;
        if (remaining > 0) {
            (bool refundSuccess, ) = payable(msg.sender).call{value: remaining}("");
            require(refundSuccess, "Refund failed");
        }
    }

    // ═══════════════════════════════════════════════════════
    //  EMERGENCY
    // ═══════════════════════════════════════════════════════

    /**
     * @dev Emergency withdraw stuck funds
     */
    function emergencyWithdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No balance");
        (bool success, ) = payable(owner()).call{value: balance}("");
        require(success, "Withdraw failed");
    }

    // ═══════════════════════════════════════════════════════
    //  HELPERS
    // ═══════════════════════════════════════════════════════

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    receive() external payable {}
}
