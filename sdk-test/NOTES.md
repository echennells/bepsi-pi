# Spark SDK Test Notes

## SDK Versions

- Production: `@buildonspark/issuer-sdk@0.0.99` (bundles `spark-sdk@0.3.6`)
- Tested: `@buildonspark/spark-sdk@0.6.4` (latest as of 2026-02-18)
- The `issuer-sdk` is NOT needed — `SparkWallet` from `spark-sdk` has all the methods the vending machine uses. `IssuerSparkWallet` only adds mint/burn/freeze (issuer-only features).

## API Changes (0.3.6 → 0.6.4)

| What | Old (0.0.99 / 0.3.6) | New (0.6.4) |
|------|----------------------|-------------|
| Address format | `sp1pgs...` | `spark1pgs...` |
| `balance.balance` type | `string` | `bigint` |
| Token balance field | `tokenData.balance` (string) | `tokenData.ownedBalance` (bigint) |
| Token decimals | `tokenData.decimals` (returned `0` for BEPSI — wrong) | `tokenData.tokenMetadata.decimals` (returns `6` — correct) |
| New token field | — | `tokenData.availableToSendBalance` (bigint) |
| Token metadata | — | `tokenData.tokenMetadata.tokenName`, `.tokenTicker`, `.maxSupply` |

## ARM64 WASM Crash (Node 18 Bug — RESOLVED)

During testing, we hit a consistent `RuntimeError: unreachable` crash in the WASM `encrypt_ecies` function on ARM64 (Apple Silicon Docker). The crash occurred during `subtractSplitAndEncrypt` → `encryptEcies` when the SDK tried to claim pending inbound transfers during wallet initialization.

### What we observed

- Crashed 100% consistently for 20+ runs on ARM64 (both Alpine musl and Debian glibc)
- Affected `spark-sdk` versions 0.5.x through 0.6.4
- `issuer-sdk@0.0.99` (bundling `spark-sdk@0.3.6`) did NOT crash
- x86_64 (via Docker `--platform linux/amd64`) worked immediately
- We built the WASM from source on ARM64 — same crash (ruling out pre-built binary issue)
- `ecies::encrypt()` worked perfectly in an isolated WASM test on ARM64
- Adding `console.log` before the WASM call appeared to fix it

### What we think happened

The crash was triggered by a specific wallet leaf/UTXO state during transfer claiming. One of our successful runs (0.0.99 init, x86_64 emulation, or patched SDK) claimed the pending transfers and reorganized the wallet's leaf structure, resolving the problematic state.

After that, the crash became unreproducible — even for brand new wallets with fresh deposits. We cannot definitively say whether this was:
1. A V8 ARM64 WASM JIT bug triggered by specific memory/optimization state
2. A server-side edge case in leaf management that self-resolved
3. A specific UTXO tree configuration that caused the WASM crypto to panic

### Reproduction (confirmed)

The crash IS reproducible. It's flaky — depends on V8 JIT optimization state:
- `node tests/07-detection.mjs` (file) → **crashes** on `wallet.transfer()` for sats
- `node --input-type=module -e "..."` (inline eval) → **works** with identical code
- Token transfers via `transferTokens()` → **always works** (different WASM code path)

The crash is in the sats `transfer()` → `subtractSplitAndEncrypt` → `encrypt_ecies` WASM call. The `ecies::encrypt` function works perfectly in isolated WASM tests — the crash only happens in the context of the full SDK's WASM module, suggesting V8 JIT miscompilation of the larger WASM binary on ARM64.

### Root Cause

**Node 18 (V8 10.2)** has a WASM JIT bug on ARM64. The `encrypt_ecies` WASM function is miscompiled by V8's Liftoff/TurboFan on aarch64. Spark's `package.json` requires `"engines": { "node": ">=20.19.0" }` — we were running below their minimum.

| Node Version | V8 | ARM64 Result |
|---|---|---|
| 18.20.8 | 10.2.154.26 | CRASHES — `unreachable` in encrypt_ecies |
| 20.20.0 | 11.3.244.8 | Works |
| 22.22.0 | 12.4.254.21 | Works |

### Fix

Use Node 20+ in Dockerfile. Production Pi must also run Node 20+.

## Detection Test Results

### Sats Detection (Node 22, working)
- **Events (`transfer:claimed`)**: Works! Fires with 2 args: `(transferId: string, updatedBalance: bigint)`.
  - `updatedBalance` is the raw sats balance (bigint), NOT a full balance object.
  - Event detected sats payment in ~4-9s.
  - Production can use `updatedBalance` directly instead of calling `getBalance()` after each event.
- **Polling (`getBalance()`)**: Also works. Detected sats ~300ms after event. Polling is a reliable fallback.

### Token Detection
- **Events**: `transfer:claimed` did NOT fire for token transfers. No token-specific events exist.
- **Polling**: Detected 1 BEPSI at poll #1 (~2.4s). Polling is the only approach for tokens.
- **Decimals**: `tokenData.tokenMetadata.decimals` now returns `6` for BEPSI — FIXED. Remove hardcode.

### Token Transfer
- `transferTokens()` works on 0.6.4. Sent 1 BEPSI in 441ms, detected by polling in 2.4s.

## Available New APIs (confirmed on 0.6.4)

From test 01 method enumeration:
- `createSatsInvoice()` — create lightning-style invoices for sats
- `createTokensInvoice()` — create invoices for token payments
- `querySparkInvoices()` — query invoice status
- `queryTokenTransactions()` — query token tx history
- `queryTokenTransactionsWithFilters()` — filtered token tx queries
- `fulfillSparkInvoice()` — fulfill a spark invoice
- `createLightningHodlInvoice()` — hodl invoices
- `getTokenBalance()` — direct token balance query
- `getTokenMetadata()` — token metadata query
- `setPrivacyEnabled()` — privacy toggle
- `batchTransferTokens()` — batch token transfers

## Production Upgrade Checklist

1. Switch from `@buildonspark/issuer-sdk` to `@buildonspark/spark-sdk` (SparkWallet)
2. Update address format handling (`spark1...` instead of `sp1...`)
3. Change `Number(balance.balance)` — still works since `Number(bigint)` is valid
4. Change `tokenData.balance` → `tokenData.ownedBalance`
5. Change `BigInt(tokenData.balance)` → use `tokenData.ownedBalance` directly (already bigint)
6. Change `tokenData.decimals` → `tokenData.tokenMetadata.decimals`
7. Remove hardcoded `decimals = 6` — SDK now returns correct value
8. Test invoice-based detection as potential improvement over polling
