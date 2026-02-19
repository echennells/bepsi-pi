/**
 * Test 01 — Wallet Initialization
 *
 * Does the new SDK initialize with existing mnemonics?
 * What's the address format? What methods are available?
 */
import {
  log, logSection, logResult, logType,
  getTestConfig, initWallet,
  cleanupWallet, enumerateWallet,
} from './helpers.mjs';

async function main() {
  logSection('Test 01 — Wallet Initialization');
  const config = getTestConfig();

  log('init', 'Initializing SparkWallet...');
  let wallet;
  try {
    const result = await initWallet(config.mnemonic);
    wallet = result.wallet;
    log('init', 'SparkWallet initialized OK');

    const addr = wallet.sparkAddress || wallet.getSparkAddress?.();
    logResult('Address', addr);
    logResult('Expected address', config.address);
    logResult('Address match', addr === config.address);

    // Enumerate methods
    const methods = enumerateWallet(wallet);
    log('init', `SparkWallet has ${methods.length} properties/methods:`);

    const fns = methods.filter(m => !m.startsWith('_') && typeof wallet[m] === 'function');
    console.log('  Functions:', fns.join(', '));

    const props = methods.filter(m => !m.startsWith('_') && typeof wallet[m] !== 'function' && m !== 'constructor');
    console.log('  Properties:', props.join(', '));
  } catch (err) {
    log('init', `SparkWallet FAILED: ${err.message}`);
    console.error(err);
  }

  if (wallet) await cleanupWallet(wallet);
  log('init', 'Test 01 complete.');
}

main().catch((err) => {
  console.error('Test 01 fatal:', err);
  process.exit(1);
});
