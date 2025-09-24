const { IssuerSparkWallet } = require('@buildonspark/issuer-sdk');
require('dotenv').config();

const targetAddress = 'sp1pgssx67qzgsqg0zv5vp98q82p22sx66w80udphrrxrh5cpawy9c0k2mftlnmk7';

async function sweepAllFunds() {
  console.log(`🧹 Sweeping all funds to: ${targetAddress}\n`);

  const pins = [4, 5, 6, 12, 13, 16];
  const walletConfigs = [];

  // Add all pin wallets
  for (const pinNo of pins) {
    const address = process.env[`SPARK_PIN_${pinNo}_ADDRESS`];
    const mnemonic = process.env[`SPARK_PIN_${pinNo}_MNEMONIC`];
    if (address && mnemonic) {
      walletConfigs.push({ name: `Pin ${pinNo}`, address, mnemonic });
    }
  }

  // Add treasury wallet
  if (process.env.SPARK_TREASURY_ADDRESS && process.env.SPARK_TREASURY_MNEMONIC) {
    walletConfigs.push({
      name: 'Treasury',
      address: process.env.SPARK_TREASURY_ADDRESS,
      mnemonic: process.env.SPARK_TREASURY_MNEMONIC
    });
  }

  let totalSwept = 0;

  for (const config of walletConfigs) {
    try {
      console.log(`\n💰 Checking ${config.name} wallet...`);

      const { wallet } = await IssuerSparkWallet.initialize({
        mnemonicOrSeed: config.mnemonic,
        options: { network: 'MAINNET' }
      });

      const balance = await wallet.getBalance();
      const currentBalance = Number(balance.balance);

      console.log(`📊 ${config.name} balance: ${currentBalance} sats`);

      if (currentBalance > 100) { // Keep small amount for fees
        const amountToSend = currentBalance - 50; // Keep 50 sats for fees

        console.log(`🚀 Transferring ${amountToSend} sats from ${config.name}...`);

        const result = await wallet.transfer({
          receiverSparkAddress: targetAddress,
          amountSats: amountToSend
        });

        console.log(`✅ Transfer successful from ${config.name}:`);
        console.log(`   - Amount: ${amountToSend} sats`);
        console.log(`   - Transaction: ${result.txId || result.transactionId || 'completed'}`);

        totalSwept += amountToSend;
      } else {
        console.log(`ℹ️  ${config.name}: Balance too low to sweep (${currentBalance} sats)`);
      }

    } catch (error) {
      console.error(`❌ Error sweeping ${config.name}:`, error.message);
    }
  }

  console.log(`\n🎯 Sweep Complete!`);
  console.log(`💰 Total amount swept: ${totalSwept} sats`);
  console.log(`📍 Destination: ${targetAddress}`);
}

sweepAllFunds().catch(console.error);