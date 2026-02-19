/**
 * Test 02 — Balance API
 *
 * Call getBalance() and deeply inspect the return structure.
 * Is balance bigint or string? Is tokenBalances still a Map?
 * What fields exist on each token? Test BigInt JSON serialization.
 */
import {
  log, logSection, logResult, logType,
  getTestConfig, initWallet, cleanupWallet, safeStringify,
} from './helpers.mjs';

async function main() {
  logSection('Test 02 — Balance API');
  const config = getTestConfig();

  log('balance', 'Initializing wallet...');
  const { wallet } = await initWallet(config.mnemonic);

  log('balance', 'Calling getBalance()...');
  const balance = await wallet.getBalance();

  // --- Top-level inspection ---
  logSection('Raw Balance Object');
  console.log('  Keys:', Object.keys(balance));
  logType('balance.balance', balance.balance);
  logType('balance.tokenBalances', balance.tokenBalances);

  // Check if balance is bigint, string, or number
  logSection('Sats Balance Details');
  logResult('Raw value', balance.balance);
  logType('typeof', balance.balance);

  // Test numeric conversion patterns (matching production code)
  try {
    const asNumber = Number(balance.balance);
    logResult('Number(balance.balance)', asNumber);
    logType('Number() result', asNumber);
  } catch (e) {
    log('balance', `Number() conversion failed: ${e.message}`);
  }

  try {
    const asBigInt = BigInt(balance.balance);
    logResult('BigInt(balance.balance)', asBigInt);
  } catch (e) {
    log('balance', `BigInt() conversion failed: ${e.message}`);
  }

  // --- Token balances ---
  logSection('Token Balances');
  logResult('Is Map?', balance.tokenBalances instanceof Map);
  logResult('Is Array?', Array.isArray(balance.tokenBalances));
  logType('typeof tokenBalances', balance.tokenBalances);

  if (balance.tokenBalances instanceof Map) {
    logResult('Size', balance.tokenBalances.size);

    for (const [tokenId, tokenData] of balance.tokenBalances) {
      logSection(`Token: ${tokenId.slice(0, 20)}...`);
      console.log('  All keys:', Object.keys(tokenData));

      // Inspect every field
      for (const [key, val] of Object.entries(tokenData)) {
        logType(`  tokenData.${key}`, val);
        logResult(`  tokenData.${key}`, val);
      }

      // Specifically check the fields we care about
      logSection('Critical Field Check');
      logType('balance', tokenData.balance);
      logType('decimals', tokenData.decimals);
      logType('ownedBalance', tokenData.ownedBalance);
      logType('availableToSendBalance', tokenData.availableToSendBalance);
      logType('name', tokenData.name);
      logType('symbol', tokenData.symbol);
    }
  } else if (balance.tokenBalances && typeof balance.tokenBalances === 'object') {
    // Maybe it's a plain object now?
    log('balance', 'tokenBalances is a plain object, iterating...');
    for (const [tokenId, tokenData] of Object.entries(balance.tokenBalances)) {
      logSection(`Token: ${tokenId.slice(0, 20)}...`);
      console.log('  All keys:', Object.keys(tokenData));
      for (const [key, val] of Object.entries(tokenData)) {
        logType(`  tokenData.${key}`, val);
      }
    }
  } else {
    log('balance', 'tokenBalances is neither Map nor object — unexpected!');
  }

  // --- JSON serialization test ---
  logSection('JSON Serialization');
  try {
    const json = JSON.stringify(balance);
    log('balance', `Standard JSON.stringify: OK (${json.length} chars)`);
    console.log('  Preview:', json.slice(0, 200));
  } catch (e) {
    log('balance', `Standard JSON.stringify FAILED: ${e.message}`);
    log('balance', 'This confirms BigInt fields exist — need custom serializer.');
  }

  try {
    const json = safeStringify(balance);
    log('balance', `Safe stringify (BigInt→string): OK (${json.length} chars)`);
    console.log(json);
  } catch (e) {
    log('balance', `Safe stringify also failed: ${e.message}`);
  }

  await cleanupWallet(wallet);
  log('balance', 'Test 02 complete.');
}

main().catch((err) => {
  console.error('Test 02 fatal:', err);
  process.exit(1);
});
