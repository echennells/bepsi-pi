/**
 * Test 04 — Token Decimal Metadata
 *
 * The old SDK returned decimals: 0 for BEPSI when it should be 6.
 * Check if this is fixed. Compare raw vs human-readable amounts.
 */
import {
  log, logSection, logResult, logType,
  getTestConfig, initWallet, cleanupWallet, safeStringify,
} from './helpers.mjs';

async function main() {
  logSection('Test 04 — Token Decimal Metadata');
  const config = getTestConfig();

  if (!config.tokenIdentifier) {
    log('tokens', 'No SPARK_BEPSITOKEN_IDENTIFIER set, skipping token tests.');
    return;
  }

  log('tokens', 'Initializing wallet...');
  const { wallet } = await initWallet(config.mnemonic);

  log('tokens', 'Fetching balance...');
  const balance = await wallet.getBalance();

  // Find the BEPSI token
  let bepsiData = null;
  let bepsiId = null;

  if (balance.tokenBalances instanceof Map) {
    if (balance.tokenBalances.has(config.tokenIdentifier)) {
      bepsiData = balance.tokenBalances.get(config.tokenIdentifier);
      bepsiId = config.tokenIdentifier;
    } else {
      // Search by partial match or iterate all
      for (const [id, data] of balance.tokenBalances) {
        log('tokens', `Found token: ${id}`);
        if (id.includes('bepsi') || data.name?.toLowerCase().includes('bepsi')) {
          bepsiData = data;
          bepsiId = id;
        }
      }
    }
  }

  if (!bepsiData) {
    log('tokens', 'BEPSI token not found in wallet balance.');
    log('tokens', 'This wallet may not hold any BEPSI tokens yet.');
    log('tokens', 'Token balances:');
    if (balance.tokenBalances instanceof Map) {
      log('tokens', `  Map size: ${balance.tokenBalances.size}`);
      for (const [id, data] of balance.tokenBalances) {
        log('tokens', `  ${id}: ${safeStringify(data)}`);
      }
    }
    await cleanupWallet(wallet);
    return;
  }

  logSection(`BEPSI Token Data (${bepsiId.slice(0, 30)}...)`);
  console.log('  All fields:', safeStringify(bepsiData));

  // --- The critical decimals check ---
  logSection('Decimals Analysis');
  logType('bepsiData.decimals', bepsiData.decimals);
  logResult('decimals value', bepsiData.decimals);

  const reportedDecimals = bepsiData.decimals;
  const expectedDecimals = 6;

  if (reportedDecimals === expectedDecimals) {
    log('tokens', 'FIXED: decimals now correctly reports 6!');
    log('tokens', 'We can remove the hardcoded decimals workaround in production.');
  } else if (reportedDecimals === 0) {
    log('tokens', 'STILL BROKEN: decimals still returns 0.');
    log('tokens', 'Must continue hardcoding decimals=6 for BEPSI in production.');
  } else {
    log('tokens', `UNEXPECTED: decimals is ${reportedDecimals} (expected 6 or 0).`);
  }

  // --- Balance calculations ---
  logSection('Balance Calculations');
  const rawBalance = bepsiData.balance;
  logType('Raw balance', rawBalance);

  try {
    const rawBigInt = BigInt(rawBalance);

    // Using reported decimals
    const withReported = Number(rawBigInt) / Math.pow(10, reportedDecimals);
    logResult(`Human-readable (reported decimals=${reportedDecimals})`, withReported);

    // Using correct decimals
    const withCorrect = Number(rawBigInt) / Math.pow(10, expectedDecimals);
    logResult(`Human-readable (correct decimals=${expectedDecimals})`, withCorrect);

    if (reportedDecimals !== expectedDecimals) {
      log('tokens', `WARNING: Using reported decimals gives ${withReported}, correct should be ${withCorrect}`);
    }
  } catch (e) {
    log('tokens', `Balance calculation failed: ${e.message}`);
  }

  // --- Check other metadata fields ---
  logSection('Other Token Metadata');
  const metaFields = ['name', 'symbol', 'tokenPublicKey', 'issuer', 'totalSupply', 'type'];
  for (const field of metaFields) {
    if (bepsiData[field] !== undefined) {
      logType(field, bepsiData[field]);
      logResult(field, bepsiData[field]);
    }
  }

  await cleanupWallet(wallet);
  log('tokens', 'Test 04 complete.');
}

main().catch((err) => {
  console.error('Test 04 fatal:', err);
  process.exit(1);
});
