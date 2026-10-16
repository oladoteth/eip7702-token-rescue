// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {RescueDelegate} from "../RescueDelegate.sol";

contract MockERC20 {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

interface IERC721Receiver {
    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4);
}

interface IERC1155Receiver {
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external returns (bytes4);
    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        returns (bytes4);
}

contract MockERC721 {
    mapping(uint256 => address) public ownerOf;

    function mint(address to, uint256 id) external {
        ownerOf[id] = to;
    }

    function safeTransferFrom(address from, address to, uint256 id) external {
        require(ownerOf[id] == from && msg.sender == from, "auth");
        ownerOf[id] = to;
        if (to.code.length > 0) {
            require(
                IERC721Receiver(to).onERC721Received(msg.sender, from, id, "")
                    == IERC721Receiver.onERC721Received.selector,
                "receiver"
            );
        }
    }
}

contract MockERC1155 {
    mapping(address => mapping(uint256 => uint256)) public balanceOf;

    function mint(address to, uint256 id, uint256 amount) external {
        balanceOf[to][id] += amount;
    }

    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata) external {
        require(msg.sender == from && balanceOf[from][id] >= amount, "auth");
        balanceOf[from][id] -= amount;
        balanceOf[to][id] += amount;
        if (to.code.length > 0) {
            require(
                IERC1155Receiver(to).onERC1155Received(msg.sender, from, id, amount, "")
                    == IERC1155Receiver.onERC1155Received.selector,
                "receiver"
            );
        }
    }

    function safeBatchTransferFrom(
        address from,
        address to,
        uint256[] calldata ids,
        uint256[] calldata amounts,
        bytes calldata
    ) external {
        require(msg.sender == from && ids.length == amounts.length, "auth");
        for (uint256 i; i < ids.length; ++i) {
            require(balanceOf[from][ids[i]] >= amounts[i], "balance");
            balanceOf[from][ids[i]] -= amounts[i];
            balanceOf[to][ids[i]] += amounts[i];
        }
        if (to.code.length > 0) {
            require(
                IERC1155Receiver(to).onERC1155BatchReceived(msg.sender, from, ids, amounts, "")
                    == IERC1155Receiver.onERC1155BatchReceived.selector,
                "receiver"
            );
        }
    }
}

contract RescueDelegateTest is Test {
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    uint256 compromisedKey = 0xA11CE;
    address compromised = vm.addr(compromisedKey);
    address payer = makeAddr("payer");
    address safe = makeAddr("safe");

    RescueDelegate delegate;
    MockERC20 token;
    MockERC721 nft;
    MockERC1155 multi;

    function setUp() public {
        delegate = new RescueDelegate(payer);
        token = new MockERC20();
        nft = new MockERC721();
        multi = new MockERC1155();

        token.mint(compromised, 1_000e18);
        nft.mint(compromised, 7);
        multi.mint(compromised, 1, 50);
        vm.deal(compromised, 1 ether);
    }

    function _fullRescue() internal view returns (RescueDelegate.Call[] memory calls) {
        calls = new RescueDelegate.Call[](4);
        calls[0] = RescueDelegate.Call(address(token), 0, abi.encodeCall(MockERC20.transfer, (safe, 1_000e18)));
        calls[1] = RescueDelegate.Call(address(nft), 0, abi.encodeCall(MockERC721.safeTransferFrom, (compromised, safe, 7)));
        calls[2] = RescueDelegate.Call(
            address(multi), 0, abi.encodeCall(MockERC1155.safeTransferFrom, (compromised, safe, 1, 50, ""))
        );
        calls[3] = RescueDelegate.Call(safe, 1 ether, "");
    }

    /// The core promise: one tx sent by the payer moves every asset class to the safe
    /// wallet, and the compromised account never needs ETH of its own.
    function test_payerRescuesAllAssetsInOneTx() public {
        vm.signAndAttachDelegation(address(delegate), compromisedKey);
        vm.prank(payer);
        RescueDelegate(payable(compromised)).execute(_fullRescue());

        assertEq(token.balanceOf(safe), 1_000e18);
        assertEq(token.balanceOf(compromised), 0);
        assertEq(nft.ownerOf(7), safe);
        assertEq(multi.balanceOf(safe, 1), 50);
        assertEq(safe.balance, 1 ether);
        assertEq(compromised.balance, 0);
    }

    /// The attacker holds the compromised key. If the delegation let that key (or anyone
    /// else) run batches, the attacker could drain through our own contract.
    function test_attackerWithCompromisedKeyCannotExecute() public {
        vm.signAndAttachDelegation(address(delegate), compromisedKey);
        vm.prank(compromised);
        vm.expectRevert(RescueDelegate.NotController.selector);
        RescueDelegate(payable(compromised)).execute(_fullRescue());
    }

    function test_strangerCannotExecuteAfterDelegation() public {
        vm.signAndAttachDelegation(address(delegate), compromisedKey);
        vm.prank(payer);
        RescueDelegate(payable(compromised)).execute(new RescueDelegate.Call[](0));

        // The delegation persists after the rescue tx.
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(RescueDelegate.NotController.selector);
        RescueDelegate(payable(compromised)).execute(_fullRescue());
    }

    /// A partial rescue must not look like success: one bad call undoes the batch.
    function test_failedCallRevertsWholeBatch() public {
        RescueDelegate.Call[] memory calls = new RescueDelegate.Call[](2);
        calls[0] = RescueDelegate.Call(address(token), 0, abi.encodeCall(MockERC20.transfer, (safe, 1_000e18)));
        calls[1] = RescueDelegate.Call(address(token), 0, abi.encodeCall(MockERC20.transfer, (safe, 1)));

        vm.signAndAttachDelegation(address(delegate), compromisedKey);
        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(RescueDelegate.CallFailed.selector, 1, abi.encodeWithSignature("Error(string)", "balance"))
        );
        RescueDelegate(payable(compromised)).execute(calls);

        assertEq(token.balanceOf(compromised), 1_000e18);
        assertEq(token.balanceOf(safe), 0);
    }

    /// Delegating gives the EOA code, so safe transfers *to* it call the receiver hooks.
    /// Without them, later airdrops or returned NFTs would bounce.
    function test_delegatedAccountStillReceivesNfts() public {
        vm.signAndAttachDelegation(address(delegate), compromisedKey);
        vm.prank(payer);
        RescueDelegate(payable(compromised)).execute(_fullRescue());

        vm.prank(safe);
        nft.safeTransferFrom(safe, compromised, 7);
        assertEq(nft.ownerOf(7), compromised);

        vm.prank(safe);
        multi.safeTransferFrom(safe, compromised, 1, 50, "");
        assertEq(multi.balanceOf(compromised, 1), 50);
    }

    /// The native sweep reads the balance when it runs, not when the batch was built, so
    /// ETH that changes in between cannot make the whole rescue revert.
    function test_sweepNativeSendsBalanceAtExecutionTime() public {
        RescueDelegate.Call[] memory calls = new RescueDelegate.Call[](2);
        calls[0] = RescueDelegate.Call(address(token), 0, abi.encodeCall(MockERC20.transfer, (safe, 1_000e18)));
        calls[1] = RescueDelegate.Call(compromised, 0, abi.encodeCall(RescueDelegate.sweepNative, (payable(safe))));

        vm.deal(compromised, 3 ether); // more than when the batch was "built" with 1 ether
        vm.signAndAttachDelegation(address(delegate), compromisedKey);
        vm.prank(payer);
        RescueDelegate(payable(compromised)).execute(calls);

        assertEq(safe.balance, 3 ether);
        assertEq(compromised.balance, 0);
        assertEq(token.balanceOf(safe), 1_000e18);
    }

    function test_sweepNativeWithZeroBalanceDoesNotRevert() public {
        vm.deal(compromised, 0);
        RescueDelegate.Call[] memory calls = new RescueDelegate.Call[](1);
        calls[0] = RescueDelegate.Call(compromised, 0, abi.encodeCall(RescueDelegate.sweepNative, (payable(safe))));
        vm.signAndAttachDelegation(address(delegate), compromisedKey);
        vm.prank(payer);
        RescueDelegate(payable(compromised)).execute(calls);
        assertEq(safe.balance, 0);
    }

    /// Only the account itself may sweep: the controller goes through execute, and no other
    /// caller can pull ETH out of a delegated account.
    function test_sweepNativeOnlyFromTheAccountItself() public {
        vm.signAndAttachDelegation(address(delegate), compromisedKey);
        vm.prank(payer);
        RescueDelegate(payable(compromised)).execute(new RescueDelegate.Call[](0));

        vm.prank(makeAddr("stranger"));
        vm.expectRevert(RescueDelegate.NotSelf.selector);
        RescueDelegate(payable(compromised)).sweepNative(payable(makeAddr("stranger")));

        vm.prank(payer);
        vm.expectRevert(RescueDelegate.NotSelf.selector);
        RescueDelegate(payable(compromised)).sweepNative(payable(safe));
    }

    /// The app predicts the delegate address off-chain and reuses it across sessions,
    /// so the CREATE2 address must depend only on the controller.
    function test_create2AddressIsDeterministicPerController() public {
        if (CREATE2_DEPLOYER.code.length == 0) {
            vm.etch(
                CREATE2_DEPLOYER,
                hex"7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3"
            );
        }
        bytes memory initCode = abi.encodePacked(type(RescueDelegate).creationCode, abi.encode(payer));
        address predicted = vm.computeCreate2Address(bytes32(0), keccak256(initCode), CREATE2_DEPLOYER);

        (bool ok, bytes memory ret) = CREATE2_DEPLOYER.call(abi.encodePacked(bytes32(0), initCode));
        assertTrue(ok);
        assertEq(address(bytes20(ret)), predicted);
        assertEq(RescueDelegate(payable(predicted)).controller(), payer);
    }
}
