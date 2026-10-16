// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {RescueDelegate} from "../RescueDelegate.sol";
import {MockERC20, HostileToken} from "./RescueDelegate.t.sol";

/// Fuzz tests for the properties the rescue depends on.
contract RescueDelegateFuzzTest is Test {
    uint256 compromisedKey = 0xBEEF;
    address compromised = vm.addr(compromisedKey);
    address payer = makeAddr("payer");
    address safe = makeAddr("safe");
    RescueDelegate delegate;
    MockERC20 token;

    function setUp() public {
        delegate = new RescueDelegate(payer);
        token = new MockERC20();
        token.mint(compromised, 1_000e18);
        vm.signAndAttachDelegation(address(delegate), compromisedKey);
        // Leave the account delegated for the rest of the test.
        vm.prank(payer);
        RescueDelegate(payable(compromised)).execute(new RescueDelegate.Call[](0));
    }

    function _transfers(uint256 n, uint256 amount) internal view returns (RescueDelegate.Call[] memory calls) {
        calls = new RescueDelegate.Call[](n);
        for (uint256 i; i < n; ++i) {
            calls[i] = RescueDelegate.Call(address(token), 0, abi.encodeCall(MockERC20.transfer, (safe, amount)), false);
        }
    }

    /// Nobody but the controller can run a batch, whatever the caller.
    function testFuzz_onlyControllerCanExecute(address caller) public {
        vm.assume(caller != payer);
        vm.prank(caller);
        vm.expectRevert(RescueDelegate.NotController.selector);
        RescueDelegate(payable(compromised)).execute(_transfers(1, 1));
    }

    /// A required call failing at any position undoes every earlier call.
    function testFuzz_requiredFailureIsAtomic(uint8 count, uint8 failAt) public {
        uint256 n = bound(count, 1, 40);
        uint256 index = bound(failAt, 0, n - 1);
        RescueDelegate.Call[] memory calls = _transfers(n, 1e18);
        calls[index].data = abi.encodeCall(MockERC20.transfer, (safe, 10_000e18));

        vm.prank(payer);
        vm.expectPartialRevert(RescueDelegate.CallFailed.selector);
        RescueDelegate(payable(compromised)).execute(calls);
        assertEq(token.balanceOf(compromised), 1_000e18);
        assertEq(token.balanceOf(safe), 0);
    }

    /// Any mix of failing optional calls never stops the required calls.
    function testFuzz_optionalFailuresNeverRevertTheBatch(uint8 count, uint256 failMask) public {
        HostileToken hostile = new HostileToken();
        uint256 n = bound(count, 1, 12);
        RescueDelegate.Call[] memory calls = new RescueDelegate.Call[](n + 1);
        uint256 failing;
        for (uint256 i; i < n; ++i) {
            bool fails = (failMask >> i) & 1 == 1;
            if (fails) failing++;
            calls[i] = fails
                ? RescueDelegate.Call(address(hostile), 0, abi.encodeCall(HostileToken.approve, (address(1), 0)), true)
                : RescueDelegate.Call(address(token), 0, abi.encodeCall(MockERC20.approve, (address(1), 0)), true);
        }
        calls[n] = RescueDelegate.Call(address(token), 0, abi.encodeCall(MockERC20.transfer, (safe, 1_000e18)), false);

        vm.recordLogs();
        vm.prank(payer);
        RescueDelegate(payable(compromised)).execute(calls);
        assertEq(token.balanceOf(safe), 1_000e18);
        uint256 skipped;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == RescueDelegate.CallSkipped.selector) skipped++;
        }
        assertEq(skipped, failing, "one CallSkipped per failing optional call");
    }

    /// The native sweep moves the whole balance, whatever it is.
    function testFuzz_sweepNativeMovesEverything(uint96 balance) public {
        vm.deal(compromised, balance);
        RescueDelegate.Call[] memory calls = new RescueDelegate.Call[](1);
        calls[0] = RescueDelegate.Call(compromised, 0, abi.encodeCall(RescueDelegate.sweepNative, (payable(safe))), false);
        vm.prank(payer);
        RescueDelegate(payable(compromised)).execute(calls);
        assertEq(safe.balance, balance);
        assertEq(compromised.balance, 0);
    }

    /// A required call that succeeds with a huge return payload does not make the batch pay
    /// to copy it.
    function test_requiredCallReturnDataIsNotCopied() public {
        HostileToken hostile = new HostileToken();
        RescueDelegate.Call[] memory calls = new RescueDelegate.Call[](1);
        calls[0] = RescueDelegate.Call(address(hostile), 0, abi.encodeCall(HostileToken.returnBomb, ()), false);
        vm.prank(payer);
        uint256 before = gasleft();
        RescueDelegate(payable(compromised)).execute(calls);
        // Producing 1 MB of return data costs the callee, not us; copying it would add millions.
        assertLt(before - gasleft(), 3_500_000);
    }

    /// Revert data copied into CallFailed is capped, so a hostile target cannot inflate it.
    function test_requiredCallRevertDataIsCapped() public {
        RevertBomb bomb = new RevertBomb();
        RescueDelegate.Call[] memory calls = new RescueDelegate.Call[](1);
        calls[0] = RescueDelegate.Call(address(bomb), 0, "", false);
        vm.prank(payer);
        try RescueDelegate(payable(compromised)).execute(calls) {
            fail("expected revert");
        } catch (bytes memory err) {
            (, bytes memory reason) = abi.decode(_stripSelector(err), (uint256, bytes));
            assertEq(reason.length, 1024);
        }
    }

    /// The gas floor accounts for the call's own costs, so an optional call that sends value
    /// to a fresh account still gets its full cap or the batch reverts.
    function test_optionalCallGasFloorCoversCallOverhead() public {
        GasProbe probe = new GasProbe();
        vm.deal(compromised, 1 ether);
        RescueDelegate.Call[] memory calls = new RescueDelegate.Call[](1);
        calls[0] = RescueDelegate.Call(address(probe), 1, abi.encodeCall(GasProbe.record, ()), true);
        uint256 cap = delegate.OPTIONAL_CALL_GAS();
        // Try a range of gas limits: the call either reverts (floor) or the probe saw the full cap.
        for (uint256 g = 200_000; g < 320_000; g += 250) {
            vm.prank(payer);
            try RescueDelegate(payable(compromised)).execute{gas: g}(calls) {
                // The probe reads gasleft() a few hundred gas into the call.
                assertGe(probe.lastGas() + 1_000, cap, "an optional call ran with less than its cap");
            } catch {}
        }
    }

    function _stripSelector(bytes memory err) internal pure returns (bytes memory out) {
        out = new bytes(err.length - 4);
        for (uint256 i; i < out.length; ++i) out[i] = err[i + 4];
    }
}

contract RevertBomb {
    fallback() external {
        assembly {
            revert(0, 100000)
        }
    }
}

contract GasProbe {
    uint256 public lastGas;

    function record() external payable {
        lastGas = gasleft();
    }
}

/// Random calls an attacker can make against a delegated account.
contract AttackHandler is Test {
    address payable public immutable account;
    address public immutable controller;

    constructor(address payable account_, address controller_) {
        account = account_;
        controller = controller_;
    }

    function execute(address caller, address to, uint256 amount) external {
        if (caller == controller) return;
        RescueDelegate.Call[] memory calls = new RescueDelegate.Call[](1);
        calls[0] = RescueDelegate.Call(to, amount % 1 ether, "", false);
        vm.prank(caller);
        try RescueDelegate(account).execute(calls) {} catch {}
    }

    function sweep(address caller, address payable to) external {
        if (caller == account) return;
        vm.prank(caller);
        try RescueDelegate(account).sweepNative(to) {} catch {}
    }

    function sendEthIn(uint96 amount) external {
        vm.deal(address(this), amount);
        (bool ok, ) = account.call{value: amount}("");
        ok;
    }
}

/// Invariant: whatever anyone but the controller (and the key holder) does, the delegated
/// account never loses tokens or ETH.
contract RescueDelegateInvariantTest is Test {
    uint256 compromisedKey = 0xC0FFEE;
    address compromised = vm.addr(compromisedKey);
    address payer = makeAddr("payer");
    RescueDelegate delegate;
    MockERC20 token;
    AttackHandler handler;
    uint256 ethFloor;

    function setUp() public {
        delegate = new RescueDelegate(payer);
        token = new MockERC20();
        token.mint(compromised, 1_000e18);
        vm.deal(compromised, 5 ether);
        vm.signAndAttachDelegation(address(delegate), compromisedKey);
        vm.prank(payer);
        RescueDelegate(payable(compromised)).execute(new RescueDelegate.Call[](0));
        handler = new AttackHandler(payable(compromised), payer);
        ethFloor = compromised.balance;
        targetContract(address(handler));
    }

    function invariant_strangersCannotMoveAssets() public view {
        assertEq(token.balanceOf(compromised), 1_000e18);
        assertGe(compromised.balance, ethFloor);
    }
}
