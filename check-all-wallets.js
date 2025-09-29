#!/usr/bin/env node

const { IssuerSparkWallet } = require("@buildonspark/issuer-sdk");

async function checkAllWallets() {
  try {
    console.log("🔍 Checking all wallet balances...\n");

    // Test wallet
    const testWallet = {
      name: "Test Wallet (sender)",
      mnemonic: "hurdle base poverty palace virus mesh hurdle pet list light saddle ski"
    };

    // Pin wallets from the generated output
    const pinWallets = [
      { name: "Pin 516", mnemonic: "stem speak test inhale pottery carpet twenty ball decade person basic dice" },
      { name: "Pin 517", mnemonic: "aisle churn want melody about crazy cabin speed sketch forum insect decide" },
      { name: "Pin 518", mnemonic: "love border carry fly season chaos have canyon battle share size relax" },
      { name: "Pin 524", mnemonic: "ship seminar soldier enact arena century invite wheat zero capable acquire eight" },
      { name: "Pin 525", mnemonic: "auction capable purity pond treat surface vacant pitch universe balcony charge cute" },
      { name: "Pin 528", mnemonic: "slender fiscal slogan aim bleak wink afraid smart airport accident orbit snack" }
    ];

    let totalSats = 0;
    let totalTokens = {};

    // Check test wallet
    console.log("💳 " + testWallet.name + ":");
    const { wallet: test } = await IssuerSparkWallet.initialize({
      mnemonicOrSeed: testWallet.mnemonic,
      options: { network: "MAINNET" }
    });
    const testBalance = await test.getBalance();
    const testSats = Number(testBalance.balance);
    console.log(`   Address: ${await test.getSparkAddress()}`);
    console.log(`   Balance: ${testSats} sats`);
    if (testBalance.tokenBalances && testBalance.tokenBalances.size > 0) {
      for (const [tokenId, tokenData] of testBalance.tokenBalances) {
        const rawAmount = BigInt(tokenData.balance);
        const tokenAmount = Number(rawAmount) / Math.pow(10, 6);
        if (tokenAmount > 0) {
          console.log(`   Token: ${tokenAmount} (${tokenId.slice(0,20)}...)`);
          totalTokens[tokenId] = (totalTokens[tokenId] || 0) + tokenAmount;
        }
      }
    }
    totalSats += testSats;
    console.log("");

    // Check all pin wallets
    for (const pinWallet of pinWallets) {
      console.log("📦 " + pinWallet.name + ":");
      try {
        const { wallet } = await IssuerSparkWallet.initialize({
          mnemonicOrSeed: pinWallet.mnemonic,
          options: { network: "MAINNET" }
        });

        const balance = await wallet.getBalance();
        const sats = Number(balance.balance);

        console.log(`   Address: ${await wallet.getSparkAddress()}`);
        console.log(`   Balance: ${sats} sats`);

        if (balance.tokenBalances && balance.tokenBalances.size > 0) {
          for (const [tokenId, tokenData] of balance.tokenBalances) {
            const rawAmount = BigInt(tokenData.balance);
            const tokenAmount = Number(rawAmount) / Math.pow(10, 6);
            if (tokenAmount > 0) {
              console.log(`   Token: ${tokenAmount} (${tokenId.slice(0,20)}...)`);
              totalTokens[tokenId] = (totalTokens[tokenId] || 0) + tokenAmount;
            }
          }
        }

        totalSats += sats;

      } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
      }
      console.log("");
    }

    console.log("=" .repeat(70));
    console.log("📊 TOTAL ACROSS ALL WALLETS");
    console.log("=" .repeat(70));
    console.log(`Total Sats: ${totalSats}`);
    if (Object.keys(totalTokens).length > 0) {
      console.log(`Total Tokens:`);
      for (const [tokenId, amount] of Object.entries(totalTokens)) {
        console.log(`  ${tokenId.slice(0,20)}...: ${amount}`);
      }
    }
    console.log("");

    if (totalSats > 0 && testSats === 0) {
      console.log("💡 Funds are stuck in pin wallets! Run a sweep to recover them.");
    }

  } catch (error) {
    console.error("❌ Check failed:", error.message);
    process.exit(1);
  }
}

checkAllWallets();