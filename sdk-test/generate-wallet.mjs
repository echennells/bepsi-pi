/**
 * Generate a fresh Spark test wallet.
 * Run locally (not in Docker) before first test:
 *   node generate-wallet.mjs
 *
 * Copy the output into test.env
 */
import * as bip39 from 'bip39';
import { SparkWallet } from '@buildonspark/spark-sdk';

async function main() {
  console.log('=== Spark Test Wallet Generator ===\n');

  const mnemonic = bip39.generateMnemonic();
  console.log('Generated mnemonic. Initializing wallet to get Spark address...\n');

  const { wallet } = await SparkWallet.initialize({
    mnemonicOrSeed: mnemonic,
    options: { network: 'MAINNET' },
  });

  const address = wallet.sparkAddress || wallet.getSparkAddress?.() || 'COULD_NOT_GET_ADDRESS';

  console.log('--- Copy the following into test.env ---\n');
  console.log(`SPARK_PIN_516_MNEMONIC=${mnemonic}`);
  console.log(`SPARK_PIN_516_ADDRESS=${address}`);
  console.log('SPARK_PIN_516_AMOUNT=1000');
  console.log('');
  console.log(`SPARK_BEPSITOKEN_IDENTIFIER=btkn1xecvlqngfwwvw2z38s67rn23r76m2vpkmwavfr9cr6ytzgqufu0ql0a4qk`);
  console.log(`SPARK_BEPSITOKEN_NAME=Bepsi Token`);
  console.log(`SPARK_BEPSITOKEN_PIN_516_AMOUNT=1.0`);

  if (wallet.cleanup) await wallet.cleanup();
  else if (wallet.cleanUp) await wallet.cleanUp();
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
