/**
 * Test 06 — Query Token Transactions (New API)
 *
 * Test queryTokenTransactionsWithFilters().
 * Could this replace balance polling for token detection?
 */
import {
  log, logSection, logResult, logType,
  getTestConfig, initWallet, cleanupWallet, safeStringify, enumerateWallet,
} from './helpers.mjs';

async function main() {
  logSection('Test 06 — Query Token Transactions');
  const config = getTestConfig();

  log('query', 'Initializing wallet...');
  const { wallet } = await initWallet(config.mnemonic);

  // --- Check which query methods exist ---
  logSection('Available Query Methods');
  const methods = enumerateWallet(wallet).filter(m =>
    typeof wallet[m] === 'function' &&
    (m.toLowerCase().includes('query') || m.toLowerCase().includes('transaction') ||
     m.toLowerCase().includes('history') || m.toLowerCase().includes('transfer'))
  );
  log('query', `Query-related methods: ${methods.join(', ') || 'NONE'}`);

  // --- Test queryTokenTransactionsWithFilters ---
  logSection('queryTokenTransactionsWithFilters()');
  if (typeof wallet.queryTokenTransactionsWithFilters === 'function') {
    // Try with no filters first
    try {
      log('query', 'Calling with no filters...');
      const result = await wallet.queryTokenTransactionsWithFilters();
      log('query', 'Query returned!');
      logType('Return type', result);

      if (Array.isArray(result)) {
        logResult('Transaction count', result.length);
        if (result.length > 0) {
          logSection('First Transaction');
          console.log(safeStringify(result[0]));
          logSection('Transaction Fields');
          console.log('  Keys:', Object.keys(result[0]));
        }
      } else if (typeof result === 'object') {
        console.log('  Keys:', Object.keys(result));
        console.log('  Full:', safeStringify(result));
      }
    } catch (e) {
      log('query', `No-filter query failed: ${e.message}`);
    }

    // Try with token filter
    if (config.tokenIdentifier) {
      try {
        log('query', `Calling with tokenIdentifier filter: ${config.tokenIdentifier.slice(0, 20)}...`);
        const result = await wallet.queryTokenTransactionsWithFilters({
          tokenIdentifier: config.tokenIdentifier,
        });
        log('query', 'Filtered query returned!');
        if (Array.isArray(result)) {
          logResult('Filtered count', result.length);
          if (result.length > 0) {
            log('query', 'Most recent:');
            console.log(safeStringify(result[0]));
          }
        } else {
          console.log('  Full:', safeStringify(result));
        }
      } catch (e) {
        log('query', `Filtered query failed: ${e.message}`);
      }

      // Try with limit
      try {
        log('query', 'Calling with limit=5...');
        const result = await wallet.queryTokenTransactionsWithFilters({
          tokenIdentifier: config.tokenIdentifier,
          limit: 5,
        });
        if (Array.isArray(result)) {
          logResult('Limited count', result.length);
        }
      } catch (e) {
        log('query', `Limited query failed: ${e.message}`);
      }
    }
  } else {
    log('query', 'queryTokenTransactionsWithFilters() not available.');
  }

  // --- Try other query methods ---
  const otherQueryMethods = [
    'getTransactions',
    'getTransferHistory',
    'getTokenTransfers',
    'queryTransactions',
    'listTransactions',
  ];

  for (const method of otherQueryMethods) {
    if (typeof wallet[method] === 'function') {
      logSection(`Trying ${method}()`);
      try {
        const result = await wallet[method]();
        logType('Return type', result);
        if (Array.isArray(result)) {
          logResult('Count', result.length);
          if (result.length > 0) {
            console.log('  First:', safeStringify(result[0]));
          }
        } else if (typeof result === 'object') {
          console.log('  Keys:', Object.keys(result));
        }
      } catch (e) {
        log('query', `${method}() failed: ${e.message}`);
      }
    }
  }

  // --- Strategy assessment ---
  logSection('Token Query Strategy Assessment');
  const hasQueryFilter = typeof wallet.queryTokenTransactionsWithFilters === 'function';

  if (hasQueryFilter) {
    log('query', 'VIABLE: queryTokenTransactionsWithFilters exists.');
    log('query', 'Strategy: Poll for new txs since last check (by timestamp or ID).');
    log('query', 'This could replace raw balance polling with tx-based detection.');
  } else {
    log('query', 'Token transaction query not available.');
    log('query', 'Must continue using balance polling for token detection.');
  }

  await cleanupWallet(wallet);
  log('query', 'Test 06 complete.');
}

main().catch((err) => {
  console.error('Test 06 fatal:', err);
  process.exit(1);
});
