# Self-hosting

This guide shows how to build Token Rescue, serve it, set the HTTP headers it needs, and add a network. For how the rescue works, see [How it works](how-it-works.md).

## Before you begin

You need Node.js 22 or later.

## Build the site

1. Install the exact dependency versions from the lockfile:

   ```sh
   npm ci
   ```

2. Build the static site:

   ```sh
   npm run build
   ```

The site is in `dist/`. It has no server-side code, so any static host can serve it.

To check the build locally, run `npm run preview`.

## Set the HTTP headers

The build adds a Content Security Policy as a `<meta>` tag in `dist/index.html`. It allows scripts, styles and fonts only from the site's own origin, and network requests to any `https:` or `wss:` host so that users can add their own RPC. The page holds private keys, so do not loosen it.

A `<meta>` tag cannot set `frame-ancestors`, so the page could be framed by another site and used for clickjacking. Send these headers from your host:

| Header | Value |
|---|---|
| `Content-Security-Policy` | `frame-ancestors 'none'` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |

Serve the site over HTTPS only.

### Example: Netlify or Cloudflare Pages

The repository includes `public/_headers`, and the build copies it to `dist/_headers`. Netlify and Cloudflare Pages apply it automatically. It contains:

```text
/*
  Content-Security-Policy: frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
```

### Example: nginx

```nginx
add_header Content-Security-Policy "frame-ancestors 'none'" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
```

A browser enforces every Content Security Policy it receives, so the header and the `<meta>` tag apply together.

## Add a network

Networks are listed in `src/utils/networks.js`. A network can only be used for a rescue if it supports EIP-7702. The app checks this live on the RPC it uses, so a network that fails the check is shown but cannot run a rescue.

1. Add an entry to `NETWORKS`:

   ```js
   example: {
     chainId: 12345,
     name: 'Example Chain',
     rpcUrl: 'https://rpc.example.org',
     rpcUrls: ['https://rpc.example.org', 'https://example-rpc.publicnode.com'],
     explorer: 'https://explorer.example.org',
     nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
     discovery: { blockscout: null, llama: null }
   }
   ```

2. Check that every RPC URL answers a browser `fetch` from another origin (CORS). RPCs that only work from a server cannot be used.
3. Set `discovery.blockscout` to a Blockscout instance root, such as `https://eth.blockscout.com`, only if its `/api/v2` endpoints answer browser requests. Otherwise leave it `null`, and users add tokens manually.
4. Set `discovery.llama` to the chain's DefiLlama ID, such as `base`. Confirm it by requesting `https://coins.llama.fi/prices/current/<id>:<token address>` for a known token.
5. Confirm that the deterministic deployment proxy `0x4e59b44847b379578588920cA78FbF26c0B4956C` has code on the chain. The rescue delegate is deployed through it.

Users can also enter an RPC for any chain under **Use your own RPC**, without changing the code. That RPC is kept for the session only.
