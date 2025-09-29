#!/usr/bin/env node

async function manualSweepToTestWallet() {
  try {
    const { IssuerSparkWallet } = await import("@buildonspark/issuer-sdk");

    // Test wallet (destination) - from GitHub secrets
    const testWalletAddress = "sp1pgss8zk663885kz8ftfexlayqgyfzpj3kjued5vwkz8y9z7646779qy3rk5rpd";

    // Pin wallets (sources) - from generated wallets
    const pinWallets = [
      { name: "Pin 516", mnemonic: "stem speak test inhale pottery carpet twenty ball decade person basic dice" },
      { name: "Pin 517", mnemonic: "aisle churn want melody about crazy cabin speed sketch forum insect decide" },
      { name: "Pin 518", mnemonic: "love border carry fly season chaos have canyon battle share size relax" },
      { name: "Pin 524", mnemonic: "ship seminar soldier enact arena century invite wheat zero capable acquire eight" },
      { name: "Pin 525", mnemonic: "auction capable purity pond treat surface vacant pitch universe balcony charge cute" },
      { name: "Pin 528", mnemonic: "slender fiscal slogan aim bleak wink afraid smart airport accident orbit snack" }
    ];

    console.log("🧹 Manual Sweep: Pin Wallets → Test Wallet");
    console.log("==========================================\n");
    console.log(`📍 Destination: ${testWalletAddress}\n`);

    let totalSwept = {
      sats: 0,
      tokens: {}
    };

    for (const pinWallet of pinWallets) {
      console.log(`💳 ${pinWallet.name}:`);

      try {
        const { wallet } = await IssuerSparkWallet.initialize({
          mnemonicOrSeed: pinWallet.mnemonic,
          options: { network: "MAINNET" }
        });

        const balance = await wallet.getBalance();
        const sats = Number(balance.balance);

        console.log(`   Balance: ${sats} sats`);

        // Sweep sats if any
        if (sats > 0) {
          try {
            const result = await wallet.transfer({
              receiverSparkAddress: testWalletAddress,
              amountSats: sats
            });
            console.log(`   ✅ Swept ${sats} sats - TX: ${result.id}`);
            totalSwept.sats += sats;
          } catch (transferError) {
            console.log(`   ❌ Sats transfer failed: ${transferError.message}`);
          }
        }

        // Sweep tokens if any
        if (balance.tokenBalances && balance.tokenBalances.size > 0) {
          console.log(`   Found ${balance.tokenBalances.size} token types`);
          for (const [tokenId, tokenData] of balance.tokenBalances) {
            const rawAmount = BigInt(tokenData.balance);
            if (rawAmount > 0n) {
              const tokenAmount = Number(rawAmount) / Math.pow(10, 6);
              try {
                const result = await wallet.transferTokens({
                  tokenIdentifier: tokenId,
                  tokenAmount: rawAmount,
                  receiverSparkAddress: testWalletAddress
                });
                console.log(`   ✅ Swept ${tokenAmount} tokens - TX: ${result}`);
                totalSwept.tokens[tokenId] = (totalSwept.tokens[tokenId] || 0) + tokenAmount;
              } catch (tokenError) {
                console.log(`   ❌ Token transfer failed: ${tokenError.message}`);
              }
            }
          }
        } else {
          console.log(`   No tokens found`);
        }

      } catch (error) {
        console.log(`   ❌ Wallet error: ${error.message}`);
      }

      console.log("");
    }

    console.log("=".repeat(50));
    console.log("📊 SWEEP SUMMARY");
    console.log("=".repeat(50));
    console.log(`Total Sats Swept: ${totalSwept.sats}`);
    if (Object.keys(totalSwept.tokens).length > 0) {
      console.log(`Total Tokens Swept:`);
      for (const [tokenId, amount] of Object.entries(totalSwept.tokens)) {
        console.log(`  ${tokenId.slice(0,20)}...: ${amount}`);
      }
    } else {
      console.log(`Total Tokens Swept: 0`);
    }
    console.log("\n✅ Manual sweep complete!");

  } catch (error) {
    console.error("❌ Manual sweep failed:", error.message);
    process.exit(1);
  }
}

manualSweepToTestWallet();