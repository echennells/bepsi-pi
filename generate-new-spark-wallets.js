#!/usr/bin/env node

/**
 * Generate new Spark wallets for vending machine pins
 */

const PINS = [516, 517, 518, 524, 525, 528];
const DRINK_NAMES = {
  516: 'coke',
  517: 'iced tea',
  518: 'poppi',
  524: 'bubbly',
  525: 'cooler',
  528: 'beer'
};

// Keep the existing treasury address
const EXISTING_TREASURY = 'sp1pgssx67qzgsqg0zv5vp98q82p22sx66w80udphrrxrh5cpawy9c0k2mftlnmk7';

async function generateWallets() {
  // Dynamic import for ES module
  const { IssuerSparkWallet } = await import('@buildonspark/issuer-sdk');
  const bip39 = await import('bip39');

  console.log('🔑 Generating new Spark wallets for vending machine pins...\n');
  console.log('=' .repeat(80));
  console.log('COPY THESE TO YOUR .ENV FILE:');
  console.log('=' .repeat(80));
  console.log();

  // Generate new wallets for each pin
  for (const pin of PINS) {
    // Generate new mnemonic
    const mnemonic = bip39.generateMnemonic();

    // Initialize wallet with mnemonic
    const { wallet } = await IssuerSparkWallet.initialize({
      mnemonicOrSeed: mnemonic,
      options: {
        network: "MAINNET",
      },
    });

    const address = wallet.sparkAddress;

    console.log(`# Pin ${pin} (${DRINK_NAMES[pin]})`);
    console.log(`SPARK_PIN_${pin}_ADDRESS=${address}`);
    console.log(`SPARK_PIN_${pin}_MNEMONIC=${mnemonic}`);
    console.log();
  }

  // Keep existing treasury address
  console.log('# Treasury wallet (keeping existing address)');
  console.log(`SPARK_TREASURY_ADDRESS=${EXISTING_TREASURY}`);
  console.log();

  console.log('=' .repeat(80));
  console.log('✅ Wallet generation complete!');
  console.log('\nIMPORTANT:');
  console.log('1. Save these mnemonics securely - they control the wallets!');
  console.log('2. Treasury address remains unchanged');
  console.log('3. Remember to fund the new wallets before using them');
}

generateWallets().catch(console.error);