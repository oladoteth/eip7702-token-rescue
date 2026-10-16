# Token Rescue

Token Rescue moves assets out of a compromised Ethereum account in one EIP-7702 transaction. A separate rescue wallet pays the gas, so the compromised account never holds ETH that a sweeper bot could take.

One transaction can move ERC-20 tokens, ERC-721 and ERC-1155 NFTs, Lido, Aave v3 and Uniswap v3 positions, the native coin balance, and any custom call you build. If any call fails, nothing moves.

The app is a static site with no backend. You can run it on your own machine or host it yourself.

## Quick start

You need Node.js 22 or later.

```sh
npm ci
npm run dev
```

The app opens at `http://localhost:3000`.

To build the static site:

```sh
npm run build
```

The output is in `dist/`. Serve it with any static host. Read [Self-hosting](docs/self-hosting.md) before you put it online.

## Documentation

| Page | Read it to |
|---|---|
| [How it works](docs/how-it-works.md) | Understand the rescue transaction, the delegate contract and the security model. |
| [Self-hosting](docs/self-hosting.md) | Build and serve the app, set the HTTP headers, and add a network. |
| [Adding a protocol adapter](docs/adding-a-protocol-adapter.md) | Support a new staking or lending protocol. |
| [Testing](docs/testing.md) | Run the contract, unit, end-to-end and fork tests. |

## Private keys

The app needs the private key of the compromised account and of the rescue wallet. Browser wallets such as MetaMask do not let a site request an EIP-7702 authorization for an arbitrary contract, so a raw key is the only way to sign one. Keys stay in the page's memory. They are never written to browser storage and never sent to a server. [How it works](docs/how-it-works.md#why-the-app-needs-private-keys) explains the details.
