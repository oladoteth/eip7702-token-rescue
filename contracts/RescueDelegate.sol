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
        /// Optional calls (approval revokes) may fail without undoing the batch. They get at
        /// most OPTIONAL_CALL_GAS and their return data is not copied, so a hostile target
        /// cannot burn the batch's gas or memory.
        bool allowFailure;
    }

    /// @notice Gas given to each optional call.
    uint256 public constant OPTIONAL_CALL_GAS = 200_000;

    /// @notice The only address allowed to call `execute`.
    address public immutable controller;

    error NotController();
    error NotSelf();
    error NativeTransferFailed();
    /// @dev Raised when there is not enough gas left to give an optional call its full cap.
    /// Without it, a gas estimate could settle where optional calls silently fail.
    error NotEnoughGasForOptionalCall();

    /// @notice An optional call failed and was skipped.
    event CallSkipped(uint256 indexed index);
    /// @param index Position of the failed call in the batch.
    /// @param reason Raw revert data from the failed call.
    error CallFailed(uint256 index, bytes reason);

    constructor(address controller_) {
        controller = controller_;
    }

    /// @notice Runs every call in order. A failed required call reverts the whole batch; a
    /// failed optional call is skipped.
    function execute(Call[] calldata calls) external {
        if (msg.sender != controller) revert NotController();
        for (uint256 i; i < calls.length; ++i) {
            Call calldata c = calls[i];
            if (c.allowFailure) {
                // 64/63 covers the gas the EVM keeps back from a sub-call (EIP-150).
                if (gasleft() < (OPTIONAL_CALL_GAS * 64) / 63 + 10_000) revert NotEnoughGasForOptionalCall();
                if (!_callWithoutReturnData(c.target, c.value, c.data)) emit CallSkipped(i);
            } else {
                (bool ok, bytes memory reason) = c.target.call{value: c.value}(c.data);
                if (!ok) revert CallFailed(i, reason);
            }
        }
    }

    function _callWithoutReturnData(address target, uint256 value, bytes calldata data) private returns (bool ok) {
        uint256 gasCap = OPTIONAL_CALL_GAS;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            calldatacopy(ptr, data.offset, data.length)
            ok := call(gasCap, target, value, ptr, data.length, 0, 0)
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
