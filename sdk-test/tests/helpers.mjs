/**
 * Shared test utilities — wallet init, logging, env loading.
 */
import 'dotenv/config';

// ============================================================================
// Logging
// ============================================================================

export function log(tag, ...args) {
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  console.log(`[${ts}] [${tag}]`, ...args);
}

export function logSection(title) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'='.repeat(60)}\n`);
}

export function logResult(label, value) {
  const display = typeof value === 'bigint' ? `${value}n (bigint)` : JSON.stringify(value);
  console.log(`  ${label}: ${display}`);
}

export function logType(label, value) {
  console.log(`  ${label}: typeof=${typeof value}, value=${String(value)}`);
}

// ============================================================================
// Environment
// ============================================================================

export function getTestConfig() {
  const mnemonic = process.env.SPARK_PIN_516_MNEMONIC;
  const address = process.env.SPARK_PIN_516_ADDRESS;
  const amount = parseInt(process.env.SPARK_PIN_516_AMOUNT || '1000');
  const tokenIdentifier = process.env.SPARK_BEPSITOKEN_IDENTIFIER;
  const tokenName = process.env.SPARK_BEPSITOKEN_NAME || 'Bepsi Token';
  const tokenAmount = parseFloat(process.env.SPARK_BEPSITOKEN_PIN_516_AMOUNT || '1.0');

  if (!mnemonic) {
    console.error('ERROR: SPARK_PIN_516_MNEMONIC not set. Copy test-env.example to test.env and fill in values.');
    process.exit(1);
  }

  return { mnemonic, address, amount, tokenIdentifier, tokenName, tokenAmount };
}

// ============================================================================
// Wallet Initialization
// ============================================================================

/**
 * Initialize wallet using SparkWallet.
 * Returns { wallet, walletClass, className }
 */
export async function initWallet(mnemonic) {
  const { SparkWallet } = await import('@buildonspark/spark-sdk');
  const result = await SparkWallet.initialize({
    mnemonicOrSeed: mnemonic,
    options: { network: 'MAINNET' },
  });
  return { wallet: result.wallet, walletClass: SparkWallet, className: 'SparkWallet' };
}

/**
 * Safely clean up a wallet connection.
 */
export async function cleanupWallet(wallet) {
  try {
    if (wallet.cleanUp) await wallet.cleanUp();
    else if (wallet.disconnect) await wallet.disconnect();
  } catch (e) {
    log('cleanup', `Warning: ${e.message}`);
  }
}

/**
 * Enumerate all methods/properties on a wallet instance.
 */
export function enumerateWallet(wallet) {
  const props = new Set();
  let obj = wallet;
  while (obj && obj !== Object.prototype) {
    Object.getOwnPropertyNames(obj).forEach((p) => props.add(p));
    obj = Object.getPrototypeOf(obj);
  }
  return [...props].sort();
}

// ============================================================================
// Safe JSON (handles BigInt)
// ============================================================================

export function safeStringify(obj, indent = 2) {
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'bigint') return `${value}n`;
    return value;
  }, indent);
}
