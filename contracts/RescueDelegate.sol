// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title RescueDelegate
/// @notice EIP-7702 delegation target for rescuing assets from a compromised EOA.
/// The compromised EOA delegates to this code. Only `controller` (the gas payer)
/// can then run a batch of calls as the compromised EOA.
/// @dev Deployed through the CREATE2 deployer 0x4e59b44847b379578588920cA78FbF26c0B4956C
/// with salt 0, so the address depends only on `controller`.
/// Uses no storage, so it cannot clash with slots left by an earlier delegation.
contract RescueDelegate {
    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    /// @notice The only address allowed to call `execute`.
    address public immutable controller;

    error NotController();
    error NotSelf();
    error NativeTransferFailed();
    /// @param index Position of the failed call in the batch.
    /// @param reason Raw revert data from the failed call.
    error CallFailed(uint256 index, bytes reason);

    constructor(address controller_) {
        controller = controller_;
    }

    /// @notice Runs every call in order. Any failed call reverts the whole batch.
    function execute(Call[] calldata calls) external {
        if (msg.sender != controller) revert NotController();
        for (uint256 i; i < calls.length; ++i) {
            (bool ok, bytes memory reason) = calls[i].target.call{value: calls[i].value}(calls[i].data);
            if (!ok) revert CallFailed(i, reason);
        }
    }

    /// @notice Sends the account's whole native balance, read when this runs, to `to`.
    /// @dev Called from inside `execute` as a call to the account itself, so a balance that
    /// changed after the batch was built cannot make the rescue revert. Only the account can
    /// call it: the holder of its key can already move this ETH directly, so that is no new power.
    function sweepNative(address payable to) external {
        if (msg.sender != address(this)) revert NotSelf();
        uint256 amount = address(this).balance;
        if (amount == 0) return;
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert NativeTransferFailed();
    }

    receive() external payable {}

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 // ERC-165
            || interfaceId == 0x150b7a02 // ERC-721 receiver
            || interfaceId == 0x4e2312e0; // ERC-1155 receiver
    }
}
