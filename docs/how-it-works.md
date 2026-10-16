# How it works

This page explains how a rescue runs, why it is built this way, and what protects it. For setup steps, see [Self-hosting](self-hosting.md).

## The problem

When an attacker has the private key of an account, a sweeper bot usually watches it. Any ETH sent to the account so it can pay gas is taken within seconds. Tokens, NFTs and staked positions stay behind, because moving them costs gas the owner can no longer provide.

## The rescue transaction

EIP-7702 lets an externally owned account (EOA) delegate its code to a contract for as long as the delegation stands. Token Rescue uses one type-4 transaction:

1. The compromised account signs an EIP-7702 authorization that delegates it to the rescue delegate contract. Signing happens in the browser and costs no gas.
2. The rescue wallet sends a type-4 transaction to the compromised address. The transaction carries the authorization in its `authorizationList` and calls `execute(calls)`.
3. The compromised account now runs the delegate's code and makes every call in the batch as itself. For example, it calls `transfer` on a token contract with the safe wallet as the recipient.
4. The rescue wallet pays all the gas. The compromised account never receives ETH.

The authorization uses the compromised account's pending nonce. If the attacker sends a transaction first, the chain skips the stale authorization without failing the transaction. The app checks that the account's code points at the delegate after the transaction is mined. It reports success only if it does.

## The three wallets

| Wallet | Role | Key needed |
|---|---|---|
| Compromised wallet | Holds the assets and signs the authorization. | Yes |
| Rescue wallet | Sends the transaction and pays the gas. It is the only address allowed to run batches through the delegate. | Yes |
| Safe wallet | Receives the assets. | No. Connect a browser wallet, generate one, import one, or reuse the rescue wallet. |

## Why the app needs private keys

MetaMask and similar browser wallets do not let a site request an EIP-7702 authorization for a contract the site chooses, and they reject type-4 transactions built by a site. A raw private key is the only way to sign the authorization and send the transaction.

The keys stay in the page's memory. They are never written to `localStorage`, `sessionStorage` or IndexedDB, and they are never sent anywhere. **Clear & Start Over** removes them from memory.

## The rescue delegate contract

`contracts/RescueDelegate.sol` is the code the compromised account delegates to.

- `controller` is an immutable address set in the constructor: the rescue wallet. Only it can call `execute`. The attacker holds the compromised key, so the compromised account itself is not allowed to run batches.
- `execute(Call[] calls)` makes each call in order. If one fails, it reverts with `CallFailed(index, reason)` and the whole batch is undone.
- `sweepNative(address to)` sends the account's whole native balance as it is when the call runs. Only the account itself can call it, which means from inside a batch. The holder of the compromised key can already move that ETH directly, so this gives them nothing new.
- It implements the ERC-721 and ERC-1155 receiver hooks, so the delegated account can still receive NFTs.
- It uses no storage, so it cannot clash with storage left by an earlier delegation.

### One address on every chain

The delegate is deployed through the deterministic deployment proxy at `0x4e59b44847b379578588920cA78FbF26c0B4956C` with a zero salt. Its address depends only on the bytecode and the controller, so a given rescue wallet has the same delegate address on every chain. The app computes the address, checks whether code is there, and deploys it only when it is missing.

The contract is compiled with Foundry with `bytecode_hash = "none"` and `cbor_metadata = false`, so the bytecode, and with it the address, is reproducible.

## Choosing what to rescue

- **Tokens and NFTs.** Blockscout lists what the account holds. The app then reads every balance on-chain (`balanceOf`, `ownerOf`), so an asset the chain does not confirm never becomes a call. DefiLlama prices tokens that Blockscout does not. Tokens worth at least $1 are pre-selected. NFTs are never pre-selected, because they have no reliable price and spam collections copy well-known names.
- **Native coin.** The sweep always runs last, so ETH released by earlier calls is included.
- **Protocol positions.** Adapters read Lido, Aave v3 and Uniswap v3 positions directly from the chain. See [Adding a protocol adapter](adding-a-protocol-adapter.md).
- **Custom calls.** Load an ABI, then build a call with the form or paste calldata. Pasted calldata must decode against the ABI and re-encode to exactly the same bytes.

Blockscout receives the compromised account's address. DefiLlama receives only token addresses. No key is sent to either. Each call records the assets it moves, so the same asset cannot be added twice. A second move would revert the whole batch.

## Safety checks

| Check | What it prevents |
|---|---|
| Live EIP-7702 check on the RPC in use | Sending through an RPC whose simulation ignores the authorization. The app delegates a throwaway account to Multicall3 and checks that the delegated code runs. An RPC that fails is never used. |
| Pre-send review | Calldata from a fake "helper" that sends assets or approvals to an address other than the safe wallet. Such calls show in red, and calls the app cannot check show in amber. Sending needs an explicit confirmation. |
| Simulation before sending | Paying gas for a batch that would revert. |
| Gas ceiling | A batch larger than one transaction may use: the block gas limit or 16,777,216 gas (EIP-7825), whichever is lower. |
| Delegation check after mining | Reporting success when a stale authorization was skipped and nothing moved. |
| Content Security Policy | Scripts from anywhere but the app's own origin. See [Self-hosting](self-hosting.md#set-the-http-headers). |

## Limits

- Automatic token scanning needs a Blockscout instance that answers browser requests. On BNB Smart Chain, Linea, Gnosis, Scroll, Mantle, Berachain, Sonic and Plasma, add tokens manually.
- Uniswap v3 positions are moved as NFTs. Closing a position inside the rescue would need price limits to avoid sandwich losses, so close it from the safe wallet afterwards.
- A transaction sent through a public RPC is visible in the mempool before it is mined. On Ethereum, a private RPC such as Flashbots Protect (`https://rpc.flashbots.net`) avoids this. Enter it in **Use your own RPC**.
