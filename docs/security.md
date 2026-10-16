# Security model and contract review

This page explains what Token Rescue protects against, what it assumes, and the results of the review of `contracts/RescueDelegate.sol`. For how a rescue runs, see [How it works](how-it-works.md).

The review below was done by the project's own development process, with tests written for each finding. It is not an independent audit. Get an outside review before relying on the contract for large amounts.

## Threat model

The attacker holds the compromised account's private key. They can sign transactions and EIP-7702 authorizations from that account at any time, and may run a sweeper bot that takes any ETH sent to it.

The rescue must hold even so:

- Only the rescue wallet (the delegate's `controller`) can run batches through the delegate. The compromised key cannot, and neither can anyone else.
- A batch moves everything it says or nothing, except approval revokes, which may fail on their own.
- No contract the batch calls can turn the call into a way to move the account's assets, or block the rescue.

Out of scope: the attacker moving assets directly with the key before the rescue lands. Nothing on-chain can stop that. A private RPC on Ethereum reduces the chance.

## Assumptions

- **The controller is an externally owned account.** The app always uses a rescue wallet with a raw private key. If the controller were a contract that a callee could trigger, the callee could re-enter `execute`.
- **The rescue wallet key stays secret.** The delegation stays in place after a rescue, so the controller keeps the power to run batches as the account until the account is delegated elsewhere. The app generates a fresh rescue wallet by default.
- **The deterministic deployment proxy at `0x4e59b44847b379578588920cA78FbF26c0B4956C` is the standard one.** The app checks that the delegate's code exists at the predicted address after deploying.

## Findings

| # | Severity | Finding | Status | Test |
|---|---|---|---|---|
| 1 | Medium | The controller was set to the compromised account in the original code, so the attacker's key could run batches and the rescue wallet could not. | Fixed in slice 1. `controller` is the rescue wallet. | `test_attackerWithCompromisedKeyCannotExecute`, `testFuzz_onlyControllerCanExecute` |
| 2 | Medium | Approval revokes call token contracts the attacker may control. As required calls, such a contract could revert only on-chain, burn gas or return a huge payload, and sink the whole rescue. | Fixed. Revokes are optional calls: capped at `OPTIONAL_CALL_GAS` (200,000 gas), no return data copied, a failure emits `CallSkipped`. The app adds the full cap per optional call to the gas limit. | `test_optionalCallFailureDoesNotRevertTheBatch`, `test_optionalCallsCannotBurnTheBatchGas`, `testFuzz_optionalFailuresNeverRevertTheBatch` |
| 3 | Low | A gas estimate searches for the least gas that succeeds. If an optional call could simply fail for lack of gas, the estimate could settle where revokes are silently skipped. | Fixed. `execute` reverts with `NotEnoughGasForOptionalCall` unless the callee can get its full cap. The check runs right before the `CALL`, with a margin for the call's own costs. | `test_optionalCallNeedsItsFullGasCap`, `test_optionalCallGasFloorCoversCallOverhead` |
| 4 | Low | Required calls copied all return data, even on success, so a hostile required target could inflate gas with a large return payload. Revert data was copied in full. | Fixed. Nothing is copied on success, and at most 1,024 bytes of revert data on failure. | `test_requiredCallReturnDataIsNotCopied`, `test_requiredCallRevertDataIsCapped` |
| 5 | Info | Reentrancy. A callee that calls back into the account reaches `execute`, which needs the controller, or `sweepNative`, which needs the account itself. | No change. Holds while the controller is an EOA. | Invariant test below |
| 6 | Info | An observer can copy the signed authorization from the mempool into their own type-4 transaction. That delegates the account to this same delegate, which only the controller can use. The worst case is a used nonce; the app checks the delegation after mining and reports it. | No change. | `isDelegatedTo` check in the app |
| 7 | Info | Cross-chain replay. An authorization signed with chain ID 0 is valid on every chain. The app always signs with the chain's real ID. | No change. | Asserted in `scripts/e2e-split.mjs` |
| 8 | Info | `sweepNative` can be called by the key holder directly. That gives them nothing: they can already move the account's ETH. | No change. | `test_sweepNativeOnlyFromTheAccountItself` |
| 9 | Info | Initialization and deployment. The delegate has no storage and no initializer, so there is nothing to front-run, and its CREATE2 address can only ever hold this exact code. | No change. | `test_create2AddressIsDeterministicPerController` |

## Property tests

`contracts/test/RescueDelegate.fuzz.t.sol` checks these properties with random inputs:

- No caller other than the controller can run a batch.
- A required call that fails at any position undoes every earlier call.
- Any mix of failing optional calls never stops the required calls, and each failure emits exactly one `CallSkipped`.
- The native sweep moves the whole balance, for any balance.
- Invariant: while a handler makes random calls to the delegated account as anyone other than the controller, the account's tokens and ETH never decrease.

To run them with more cases than the default:

```sh
FOUNDRY_FUZZ_RUNS=10000 FOUNDRY_INVARIANT_RUNS=1000 forge test --match-contract "Fuzz|Invariant"
```

At review time this ran 40,000 fuzz cases and 500,000 invariant calls with no failures.

## Reporting a vulnerability

Open a private security advisory on the GitHub repository instead of a public issue.
