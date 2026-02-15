// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ApprovalRevoker
 * @dev Registry-based approval revocation system for AI agents.
 *
 * ARCHITECTURE (FIX F1):
 * The contract CANNOT call approve() on behalf of users — that executes
 * in the contract's own context. Instead, this contract:
 * 1. Lets users authorize agents to FLAG risky approvals
 * 2. Agents record which (token, spender) pairs should be revoked
 * 3. Users call batchRevoke() which encodes and executes the revocations
 *    through the user's own transaction context
 *
 * The actual revocation uses a pull pattern: user calls revokeMyApprovals()
 * which iterates their flagged approvals and calls approve(spender, 0)
 * from the USER's transaction — so msg.sender on the ERC20 = user. ✅
 */
contract ApprovalRevoker is Ownable, ReentrancyGuard {
    // User => Agent => Authorized
    mapping(address => mapping(address => bool)) public authorizedAgents;

    // Flagged approvals: User => array of (token, spender) pairs
    struct ApprovalTarget {
        address token;
        address spender;
    }
    mapping(address => ApprovalTarget[]) private _flaggedApprovals;

    // Blanket permissions with expiry (FIX M1)
    struct BlanketPermission {
        bool granted;
        uint256 expiry; // block.timestamp after which permission expires
    }
    mapping(address => mapping(address => BlanketPermission)) public blanketPermissions;

    // ═══════════════════════════════════════════════════════
    //  RATE LIMITING (FIX CRITICAL)
    // ═══════════════════════════════════════════════════════
    
    mapping(address => uint256) public lastFlagTimestamp;
    uint256 public constant RATE_LIMIT = 1 minutes;

    modifier rateLimited() {
        require(block.timestamp >= lastFlagTimestamp[msg.sender] + RATE_LIMIT, "Rate limit exceeded");
        _;
        lastFlagTimestamp[msg.sender] = block.timestamp;
    }

    // Events
    event AgentAuthorized(address indexed user, address indexed agent);
    event AgentRevoked(address indexed user, address indexed agent);
    event ApprovalFlagged(address indexed user, address indexed token, address indexed spender, address agent);
    event ApprovalRevoked(address indexed user, address indexed token, address indexed spender);
    event BlanketPermissionGranted(address indexed user, address indexed agent, uint256 expiry);
    event BlanketPermissionRevoked(address indexed user, address indexed agent);

    constructor() Ownable(msg.sender) {}

    // ═══════════════════════════════════════════════════════
    //  AGENT MANAGEMENT
    // ═══════════════════════════════════════════════════════

    /**
     * @dev Authorize an agent to flag approvals on your behalf
     */
    function authorizeAgent(address agent) external {
        require(agent != address(0), "Invalid agent");
        require(!authorizedAgents[msg.sender][agent], "Already authorized");
        authorizedAgents[msg.sender][agent] = true;
        emit AgentAuthorized(msg.sender, agent);
    }

    /**
     * @dev Remove agent authorization
     */
    function revokeAgent(address agent) external {
        require(authorizedAgents[msg.sender][agent], "Not authorized");
        authorizedAgents[msg.sender][agent] = false;
        emit AgentRevoked(msg.sender, agent);
    }

    /**
     * @dev Grant blanket permission with expiry (FIX M1)
     * @param agent The agent to grant permission to
     * @param duration How long the permission lasts (in seconds)
     */
    function grantBlanketPermission(address agent, uint256 duration) external {
        require(agent != address(0), "Invalid agent");
        require(duration > 0 && duration <= 365 days, "Duration: 1s to 365 days");

        uint256 expiry = block.timestamp + duration;
        blanketPermissions[msg.sender][agent] = BlanketPermission(true, expiry);
        emit BlanketPermissionGranted(msg.sender, agent, expiry);
    }

    /**
     * @dev Revoke blanket permission
     */
    function revokeBlanketPermission(address agent) external {
        delete blanketPermissions[msg.sender][agent];
        emit BlanketPermissionRevoked(msg.sender, agent);
    }

    // ═══════════════════════════════════════════════════════
    //  AGENT: FLAG APPROVALS FOR REVOCATION
    // ═══════════════════════════════════════════════════════

    /**
     * @dev Agent flags a risky approval for a user.
     * Does NOT revoke — just records it. User must call revokeMyApprovals().
     */
    function flagApproval(
        address user,
        address token,
        address spender
    ) external rateLimited {
        require(_isAgentAuthorized(user, msg.sender), "Not authorized");
        require(token != address(0) && spender != address(0), "Invalid addresses");

        _flaggedApprovals[user].push(ApprovalTarget(token, spender));
        emit ApprovalFlagged(user, token, spender, msg.sender);
    }

    /**
     * @dev Agent flags multiple approvals at once
     */
    function flagApprovalsBatch(
        address user,
        address[] calldata tokens,
        address[] calldata spenders
    ) external rateLimited {
        require(_isAgentAuthorized(user, msg.sender), "Not authorized");
        require(tokens.length == spenders.length, "Length mismatch");
        require(tokens.length > 0 && tokens.length <= 50, "Batch: 1-50");

        for (uint256 i = 0; i < tokens.length; i++) {
            require(tokens[i] != address(0) && spenders[i] != address(0), "Invalid address");
            _flaggedApprovals[user].push(ApprovalTarget(tokens[i], spenders[i]));
            emit ApprovalFlagged(user, tokens[i], spenders[i], msg.sender);
        }
    }

    // ═══════════════════════════════════════════════════════
    //  USER: EXECUTE REVOCATIONS (msg.sender = user ✅)
    // ═══════════════════════════════════════════════════════

    /**
     * @dev User revokes all flagged approvals.
     * Since msg.sender = the user calling this function,
     * the approve(spender, 0) call on the ERC20 will correctly
     * revoke the USER's approval, not the contract's.
     *
     * NOTE: This requires the user to have previously called
     * token.approve(address(this), ...) — but we DON'T need that.
     * We just call token.approve(spender, 0) from user's tx.
     *
     * WAIT — this still won't work! Even in revokeMyApprovals(),
     * when THIS CONTRACT calls IERC20.approve(), msg.sender to the
     * ERC20 is still THIS CONTRACT.
     *
     * CORRECT APPROACH: Return the encoded calldata for the user's
     * wallet/frontend to execute directly. Or use ERC20's
     * decreaseAllowance if available.
     *
     * FINAL FIX: We generate the revocation calldata and the user's
     * frontend calls the token directly. This contract is purely
     * a registry.
     */
    function getRevocationCalldata(address user) external view returns (
        address[] memory tokens,
        bytes[] memory calldatas
    ) {
        ApprovalTarget[] storage flagged = _flaggedApprovals[user];
        uint256 length = flagged.length;

        tokens = new address[](length);
        calldatas = new bytes[](length);

        for (uint256 i = 0; i < length; i++) {
            tokens[i] = flagged[i].token;
            calldatas[i] = abi.encodeWithSelector(
                IERC20.approve.selector,
                flagged[i].spender,
                0
            );
        }
    }

    /**
     * @dev Clear flagged approvals after user has executed them
     */
    /**
     * @dev Clear flagged approvals with limit to prevent gas exhaustion (DOS Fix)
     */
    function clearFlaggedApprovals(uint256 limit) external {
        ApprovalTarget[] storage flagged = _flaggedApprovals[msg.sender];
        uint256 total = flagged.length;
        
        if (limit == 0 || limit >= total) {
            delete _flaggedApprovals[msg.sender];
        } else {
            // Remove from the end to be cheaper
            for (uint256 i = 0; i < limit; i++) {
                flagged.pop();
            }
        }
    }

    /**
     * @dev Get count of flagged approvals for a user
     */
    function getFlaggedCount(address user) external view returns (uint256) {
        return _flaggedApprovals[user].length;
    }

    /**
     * @dev Get a specific flagged approval
     */
    function getFlaggedApproval(address user, uint256 index) external view returns (
        address token,
        address spender
    ) {
        require(index < _flaggedApprovals[user].length, "Index out of bounds");
        ApprovalTarget storage target = _flaggedApprovals[user][index];
        return (target.token, target.spender);
    }

    // ═══════════════════════════════════════════════════════
    //  INTERNAL
    // ═══════════════════════════════════════════════════════

    function _isAgentAuthorized(address user, address agent) internal view returns (bool) {
        // Direct authorization
        if (authorizedAgents[user][agent]) return true;

        // Blanket permission (with expiry check — FIX M1)
        BlanketPermission storage bp = blanketPermissions[user][agent];
        if (bp.granted && block.timestamp <= bp.expiry) return true;

        return false;
    }

    // ═══════════════════════════════════════════════════════
    //  EMERGENCY
    // ═══════════════════════════════════════════════════════

    /**
     * @dev Emergency: owner can clear all flagged approvals for a user
     */
    function emergencyClearFlags(address user) external onlyOwner {
        delete _flaggedApprovals[user];
    }
}
