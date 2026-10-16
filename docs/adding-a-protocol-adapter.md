# Adding a protocol adapter

This guide shows how to add support for a staking, lending or liquidity protocol. An adapter finds the compromised account's positions on-chain and builds the calls that release them to the safe wallet. The Lido, Aave v3 and Uniswap v3 adapters in `src/positions/` are working examples.

## Before you begin

- Read [How it works](how-it-works.md#choosing-what-to-rescue).
- Find the protocol's contract addresses for each chain, and confirm each one with a real call on that chain. Do not copy addresses without checking them.

## Write the adapter

Create `src/positions/<protocol>.js` and export an object with these fields:

| Field | Type | Purpose |
|---|---|---|
| `id` | `string` | Unique ID, such as `'aave-v3'`. Positions refer to it. |
| `name` | `string` | Name shown in the UI. |
| `supports(chainId)` | `(number) => boolean` | Whether the protocol is deployed on that chain. |
| `detect({ chainId, provider, address })` | `async => Position[]` | Reads the account's positions from the chain. |
| `buildCalls(position, actionId, { from, to })` | `=> Call[]` | Builds the calls for one action. `from` is the compromised account and `to` is the safe wallet. |

### Detect positions

`detect` must read only from the chain through `provider`. Do not call an outside API: the rescue must not depend on a service that can be down or wrong.

To read many values at once, use `readMany(provider, calls)` from `src/discovery/balances.js`. It uses Multicall3 when the chain has it, and a call that fails does not fail the others.

Return one object per position:

| Field | Purpose |
|---|---|
| `id` | Unique per position, such as `'aave:<aToken address>'`. |
| `adapter` | The adapter's `id`. |
| `title` | One line for the UI. |
| `details` | Array of short lines, such as the amount. |
| `warning` | Optional text shown in amber, or `null`. |
| `covers` | Keys of the assets the position's calls move. Use `erc20Key(token)` and `nftKey(token, tokenId)` from `src/utils/batchKeys.js`. |
| `actions` | Array of `{ id, label, description }`. The first one is the default. |
| `data` | Whatever `buildCalls` needs. |

### Build calls

Each call is an object with `target`, `value` (a `bigint`, usually `0n`), `data`, `contractName`, `functionName` and `args` (strings for display). Set `source: 'position'` and `covers` to the keys of the assets that call moves.

Follow these rules:

- Send assets straight to the safe wallet (`to`) wherever the protocol allows a recipient. When the amount is only known at execution time, use the protocol's "all" value, such as `type(uint256).max` for Aave `withdraw`, instead of an amount read during the scan.
- Never grant an approval to any address other than the safe wallet.
- Leave out actions that swap or trade without a price limit. A rescue transaction is visible before it is mined and can be sandwiched.

## Register the adapter

Add it to `ADAPTERS` in `src/positions/index.js`:

```js
import { example } from './example.js';

export const ADAPTERS = [lido, aave, uniswapV3, example];
```

## Make the review recognise the calls

The pre-send review shows calls it cannot decode in amber. If your calls send assets to a recipient argument, add the function to `reviewInterface` in `src/utils/callReview.js`, and add the name of its recipient argument to `RECIPIENT_ARG`. The review then shows the call in green when the recipient is the safe wallet, and in red when it is any other address.

## Test the adapter

1. Add unit tests to `tests/positions.test.mjs` that build each action's calls and check:
   - The decoded recipient is the safe wallet.
   - `reviewCall(call, safe).level` is `'ok'`.
   - The amounts and token IDs are the ones from `data`.
2. Extend `scripts/fork-positions.mjs` to create a real position on a mainnet fork, detect it, rescue it, and check the assets arrived at the safe wallet.
3. Run both:

   ```sh
   npm test
   npm run test:fork
   ```

For details on the test setup, see [Testing](testing.md).
