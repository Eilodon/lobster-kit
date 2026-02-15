// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Address.sol";

/**
 * @title BatchExecutor
 * @dev Execute multiple transactions in a single call to save gas.
 *
 * FIX F2: Added authorizedExecutors mapping — only owner or authorized
 *         addresses can call batch functions. No more open proxy.
 * FIX H3: Replaced transfer() with call{value:}().
 * FIX CRITICAL: Refund failure no longer reverts transaction (Anti-Brick).
 */
contract BatchExecutor is Ownable, ReentrancyGuard {
    using Address for address payable;

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
    event RefundAvailable(address indexed recipient, uint256 amount); // Pull Pattern
    event RefundWithdrawn(address indexed recipient, uint256 amount); // Pull Pattern
    
    // ═══════════════════════════════════════════════════════
    //  STATE VARIABLES
    // ═══════════════════════════════════════════════════════

    // User => Pending ETH Refund
    mapping(address => uint256) public pendingRefunds;

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

        _refundExcess();

        bool[] memory allSuccess = new bool[](targets.length);
        for (uint256 i = 0; i < targets.length; i++) {
            allSuccess[i] = true;
        }
        emit BatchExecuted(msg.sender, targets.length, allSuccess);
    }

    // ═══════════════════════════════════════════════════════
    //  BATCH EXECUTION (tolerant — continue on failure)
    // ═══════════════════════════════════════════════════════

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

        _refundExcess();

        emit BatchExecuted(msg.sender, targets.length, success);
    }

    // ═══════════════════════════════════════════════════════
    //  SINGLE EXECUTION
    // ═══════════════════════════════════════════════════════

    function executeSingle(
        address target,
        uint256 value,
        bytes calldata data
    ) external payable onlyAuthorized nonReentrant returns (bool success, bytes memory result) {
        require(target != address(0), "Invalid target");
        (success, result) = target.call{value: value}(data);
        emit SingleExecuted(msg.sender, target, success);

        _refundExcess();
    }

    // ═══════════════════════════════════════════════════════
    //  INTERNAL
    // ═══════════════════════════════════════════════════════

    // ═══════════════════════════════════════════════════════
    //  REFUND MECHANISM (FIX: PULL OVER PUSH)
    // ═══════════════════════════════════════════════════════

    /**
     * @dev Accumulate excess ETH as pending refund for the caller.
     * Trustless: User must withdraw. No risk of bricking via failed transfer.
     */
    function _refundExcess() internal {
        uint256 remaining = address(this).balance;
        if (remaining > 0) {
            pendingRefunds[msg.sender] += remaining;
            emit RefundAvailable(msg.sender, remaining);
        }
    }

    /**
     * @dev User withdraws their pending refund.
     */
    function withdrawRefund() external nonReentrant {
        uint256 amount = pendingRefunds[msg.sender];
        require(amount > 0, "No pending refund");

        pendingRefunds[msg.sender] = 0;
        
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Transfer failed"); // Revert is safe here - user's own tx
        
        emit RefundWithdrawn(msg.sender, amount);
    }

    // ═══════════════════════════════════════════════════════
    //  EMERGENCY
    // ═══════════════════════════════════════════════════════

    function emergencyWithdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No balance");
        (bool success, ) = payable(owner()).call{value: balance}("");
        require(success, "Withdraw failed");
    }

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
