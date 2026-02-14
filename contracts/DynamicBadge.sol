// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title DynamicBadge
 * @dev ERC721 contract for minting dynamic NFT badges.
 *
 * FIX F3: Added minter role — only authorized minters can mint.
 * FIX H1: Uses ERC721Enumerable for O(1) tokenOfOwnerByIndex.
 * FIX H2: Stores badge type separately for O(1) type lookup.
 */
contract DynamicBadge is ERC721Enumerable, Ownable {
    using Strings for uint256;

    uint256 private _nextTokenId;

    // Authorized minters (FIX F3)
    mapping(address => bool) public authorizedMinters;

    // Token ID => Metadata URI (can be data URI or IPFS)
    mapping(uint256 => string) private _tokenMetadata;

    // Token ID => Badge Type (FIX H2 — O(1) lookup instead of string scan)
    mapping(uint256 => string) private _badgeTypes;

    // Owner => Badge Type => bool (FIX H2 — O(1) hasBadgeType check)
    mapping(address => mapping(string => bool)) private _ownerHasBadgeType;

    // Events
    event BadgeMinted(address indexed to, uint256 indexed tokenId, string badgeType);
    event MinterAuthorized(address indexed minter);
    event MinterRevoked(address indexed minter);

    modifier onlyMinter() {
        require(
            msg.sender == owner() || authorizedMinters[msg.sender],
            "Not authorized minter"
        );
        _;
    }

    constructor() ERC721("ClawKit Badge", "CLAW") Ownable(msg.sender) {}

    // ═══════════════════════════════════════════════════════
    //  MINTER MANAGEMENT (FIX F3)
    // ═══════════════════════════════════════════════════════

    function authorizeMinter(address minter) external onlyOwner {
        require(minter != address(0), "Invalid minter");
        authorizedMinters[minter] = true;
        emit MinterAuthorized(minter);
    }

    function revokeMinter(address minter) external onlyOwner {
        authorizedMinters[minter] = false;
        emit MinterRevoked(minter);
    }

    // ═══════════════════════════════════════════════════════
    //  MINTING (FIX F3: onlyMinter)
    // ═══════════════════════════════════════════════════════

    /**
     * @dev Mint a single badge
     * @param to Recipient address
     * @param metadata Token metadata URI (data URI or IPFS)
     * @param badgeType Badge type string (e.g., "BRONZE", "SILVER")
     */
    function mint(
        address to,
        string memory metadata,
        string memory badgeType
    ) public onlyMinter returns (uint256) {
        require(to != address(0), "Invalid recipient");
        require(bytes(metadata).length > 0, "Empty metadata");
        require(bytes(badgeType).length > 0, "Empty badge type");

        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _tokenMetadata[tokenId] = metadata;
        _badgeTypes[tokenId] = badgeType;
        _ownerHasBadgeType[to][badgeType] = true;

        emit BadgeMinted(to, tokenId, badgeType);
        return tokenId;
    }

    /**
     * @dev Batch mint badges
     */
    function batchMint(
        address[] calldata recipients,
        string[] calldata metadatas,
        string[] calldata badgeTypes
    ) external onlyMinter returns (uint256[] memory tokenIds) {
        require(
            recipients.length == metadatas.length &&
            metadatas.length == badgeTypes.length,
            "Length mismatch"
        );
        require(recipients.length > 0 && recipients.length <= 50, "Batch: 1-50");

        tokenIds = new uint256[](recipients.length);
        for (uint256 i = 0; i < recipients.length; i++) {
            tokenIds[i] = mint(recipients[i], metadatas[i], badgeTypes[i]);
        }
    }

    // ═══════════════════════════════════════════════════════
    //  QUERIES (FIX H1/H2 — O(1) via ERC721Enumerable + mappings)
    // ═══════════════════════════════════════════════════════

    /**
     * @dev Check if owner has a specific badge type — O(1)
     */
    function hasBadgeType(address owner_, string memory badgeType) external view returns (bool) {
        return _ownerHasBadgeType[owner_][badgeType];
    }

    /**
     * @dev Get badge type for a token
     */
    function getBadgeType(uint256 tokenId) external view returns (string memory) {
        require(tokenId < _nextTokenId, "Token does not exist");
        return _badgeTypes[tokenId];
    }

    /**
     * @dev Get all token IDs owned by an address
     * Uses ERC721Enumerable — each lookup is O(1)
     */
    function tokensOfOwner(address owner_) external view returns (uint256[] memory) {
        uint256 count = balanceOf(owner_);
        uint256[] memory tokens = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            tokens[i] = tokenOfOwnerByIndex(owner_, i);
        }
        return tokens;
    }

    // ═══════════════════════════════════════════════════════
    //  METADATA
    // ═══════════════════════════════════════════════════════

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(tokenId < _nextTokenId, "Token does not exist");
        return _tokenMetadata[tokenId];
    }

    /**
     * @dev Update metadata for a token (owner or minter only)
     */
    function updateMetadata(uint256 tokenId, string memory newMetadata) external onlyMinter {
        require(tokenId < _nextTokenId, "Token does not exist");
        require(bytes(newMetadata).length > 0, "Empty metadata");
        _tokenMetadata[tokenId] = newMetadata;
    }

    /**
     * @dev Total supply helper
     */
    function nextTokenId() external view returns (uint256) {
        return _nextTokenId;
    }

    // Required override for ERC721Enumerable
    function supportsInterface(bytes4 interfaceId) public view override(ERC721Enumerable) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
