#!/usr/bin/env node

async function sweepAllPinsToTreasury() {
  try {
    const { IssuerSparkWallet } = await import("@buildonspark/issuer-sdk");

    const treasuryAddress = "sp1pgssx67qzgsqg0zv5vp98q82p22sx66w80udphrrxrh5cpawy9c0k2mftlnmk7";

    const wallets = [
      { pin: 516, mnemonic: "vessel cricket enhance left visa pill pizza use lion air present blanket" },
      { pin: 517, mnemonic: "suit among wisdom lawn forward dwarf picnic suspect report series trip muscle" },
      { pin: 518, mnemonic: "large certain inside soda average blind access grant peasant absent royal since" },
      { pin: 524, mnemonic: "insect duck isolate metal uncover ill original physical dismiss quantum hunt fun" },
      { pin: 525, mnemonic: "crack return portion wire gate jeans direct board mix pledge solar unaware" },
      { pin: 528, mnemonic: "shaft illegal century reform siren mouse add river endorse evil praise can" },
    ];

    console.log("🧹 Sweeping All Pin Wallets to Treasury\n");
    console.log(`📍 Treasury: ${treasuryAddress}\n`);

    let totalSats = 0;
    const totalTokens = {};

    for (const { pin, mnemonic } of wallets) {
      console.log(`📦 Pin ${pin}:`);

      try {
        const { wallet } = await IssuerSparkWallet.initialize({
          mnemonicOrSeed: mnemonic,
          options: {
            network: "MAINNET",
          },
        });

        const sp1Address = await wallet.getSparkAddress();
        console.log(`   Address: ${sp1Address}`);

        const balance = await wallet.getBalance();
        const sats = Number(balance.balance);
        console.log(`   Balance: ${sats} sats`);

        if (balance.tokenBalances && balance.tokenBalances.size > 0) {
          console.log(`   Tokens:`);
          for (const [tokenId, tokenData] of balance.tokenBalances) {
            const rawAmount = BigInt(tokenData.balance);
            if (rawAmount > 0n) {
              const tokenAmount = Number(rawAmount) / Math.pow(10, 6);
              console.log(`      ${tokenId.slice(0,20)}...: ${tokenAmount}`);
            }
          }
        }

        if (sats > 0) {
          console.log(`   💸 Sweeping ${sats} sats...`);
          const result = await wallet.transfer({
            receiverSparkAddress: treasuryAddress,
            amountSats: sats
          });
          console.log(`   ✅ Swept sats! TX: ${result.id}`);
          totalSats += sats;
        }

        if (balance.tokenBalances && balance.tokenBalances.size > 0) {
          for (const [tokenId, tokenData] of balance.tokenBalances) {
            const rawAmount = BigInt(tokenData.balance);
            if (rawAmount > 0n) {
              const tokenAmount = Number(rawAmount) / Math.pow(10, 6);
              console.log(`   💸 Sweeping ${tokenAmount} tokens...`);
              const result = await wallet.transferTokens({
                tokenIdentifier: tokenId,
                tokenAmount: rawAmount,
                receiverSparkAddress: treasuryAddress
              });
              console.log(`   ✅ Swept tokens! TX: ${result}`);

              if (!totalTokens[tokenId]) {
                totalTokens[tokenId] = 0;
              }
              totalTokens[tokenId] += tokenAmount;
            }
          }
        }

        if (sats === 0 && (!balance.tokenBalances || balance.tokenBalances.size === 0)) {
          console.log(`   ℹ️  No funds to sweep`);
        }

        console.log("");

      } catch (error) {
        console.log(`   ❌ Error: ${error.message}\n`);
      }
    }

    console.log("═".repeat(70));
    console.log("📊 SWEEP SUMMARY");
    console.log("═".repeat(70));
    console.log(`Total Sats: ${totalSats}`);
    if (Object.keys(totalTokens).length > 0) {
      console.log(`Tokens:`);
      for (const [tokenId, amount] of Object.entries(totalTokens)) {
        console.log(`  ${tokenId.slice(0,20)}...: ${amount}`);
      }
    }
    console.log(`\n✅ Sweep complete!`);
    console.log(`📍 All funds sent to: ${treasuryAddress}\n`);

  } catch (error) {
    console.error("❌ Sweep failed:", error.message);
    process.exit(1);
  }
}

sweepAllPinsToTreasury();