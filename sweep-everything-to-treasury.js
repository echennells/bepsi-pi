#!/usr/bin/env node

async function sweepEverythingToTreasury() {
  try {
    const { IssuerSparkWallet } = await import("@buildonspark/issuer-sdk");

    const treasuryAddress = "sp1pgssx67qzgsqg0zv5vp98q82p22sx66w80udphrrxrh5cpawy9c0k2mftlnmk7";

    // All known wallet mnemonics from session
    const allWallets = [
      // Original pin wallets
      { name: "Pin 516 (old)", mnemonic: "vessel cricket enhance left visa pill pizza use lion air present blanket" },
      { name: "Pin 517 (old)", mnemonic: "suit among wisdom lawn forward dwarf picnic suspect report series trip muscle" },
      { name: "Pin 518 (old)", mnemonic: "large certain inside soda average blind access grant peasant absent royal since" },
      { name: "Pin 524 (old)", mnemonic: "insect duck isolate metal uncover ill original physical dismiss quantum hunt fun" },
      { name: "Pin 525 (old)", mnemonic: "crack return portion wire gate jeans direct board mix pledge solar unaware" },
      { name: "Pin 528 (old)", mnemonic: "shaft illegal century reform siren mouse add river endorse evil praise can" },

      // Test wallets
      { name: "Torch test wallet", mnemonic: "torch feed course slide abstract october bullet trophy sudden ripple lens busy" },

      // First new set
      { name: "Pin 516 (set 1)", mnemonic: "obscure warm decide play total upgrade very treat carbon cherry tube brain" },
      { name: "Pin 517 (set 1)", mnemonic: "bike belt denial dice stage potato glue involve float rebuild bike ticket" },
      { name: "Pin 518 (set 1)", mnemonic: "ill april enrich know reveal grunt knife enrich print theory dad village" },
      { name: "Pin 524 (set 1)", mnemonic: "flight coil stage siege sunset pumpkin regret flip tiny ski quantum collect" },
      { name: "Pin 525 (set 1)", mnemonic: "marriage juice mosquito vacant ignore head drift broken wrestle sure reduce zebra" },
      { name: "Pin 528 (set 1)", mnemonic: "busy memory coral loan inside cricket adjust fever wasp cause essay luxury" },

      // Second new set
      { name: "Pin 516 (set 2)", mnemonic: "brass reveal until one rare razor blanket impact series current bamboo dash" },
      { name: "Pin 517 (set 2)", mnemonic: "jungle mask average title utility museum mimic verify delay else spot avoid" },
      { name: "Pin 518 (set 2)", mnemonic: "six dry cradle gauge violin list roof cat trust cram coil latin" },
      { name: "Pin 524 (set 2)", mnemonic: "turkey then before ask joy virus kick yellow enforce board hedgehog burden" },
      { name: "Pin 525 (set 2)", mnemonic: "staff local jazz island mind wire fly economy recycle accident fee best" },
      { name: "Pin 528 (set 2)", mnemonic: "journey fiscal surface myself put noodle window hello amount ocean penalty body" },
    ];

    console.log("🧹 COMPREHENSIVE SWEEP TO TREASURY\n");
    console.log(`📍 Treasury: ${treasuryAddress}\n`);

    let totalSats = 0;
    const totalTokens = {};

    for (const { name, mnemonic } of allWallets) {
      console.log(`📦 ${name}:`);

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
          try {
            const result = await wallet.transfer({
              receiverSparkAddress: treasuryAddress,
              amountSats: sats
            });
            console.log(`   ✅ Swept sats! TX: ${result.id}`);
            totalSats += sats;
          } catch (error) {
            console.log(`   ❌ Failed to sweep sats: ${error.message}`);
          }
        }

        if (balance.tokenBalances && balance.tokenBalances.size > 0) {
          for (const [tokenId, tokenData] of balance.tokenBalances) {
            const rawAmount = BigInt(tokenData.balance);
            if (rawAmount > 0n) {
              const tokenAmount = Number(rawAmount) / Math.pow(10, 6);
              console.log(`   💸 Sweeping ${tokenAmount} tokens...`);
              try {
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
              } catch (error) {
                console.log(`   ❌ Failed to sweep tokens: ${error.message}`);
              }
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
    console.log("📊 COMPREHENSIVE SWEEP SUMMARY");
    console.log("═".repeat(70));
    console.log(`Total Sats: ${totalSats}`);
    if (Object.keys(totalTokens).length > 0) {
      console.log(`Tokens:`);
      for (const [tokenId, amount] of Object.entries(totalTokens)) {
        console.log(`  ${tokenId.slice(0,20)}...: ${amount}`);
      }
    }
    console.log(`\n✅ Comprehensive sweep complete!`);
    console.log(`📍 All funds sent to: ${treasuryAddress}\n`);

  } catch (error) {
    console.error("❌ Comprehensive sweep failed:", error.message);
    process.exit(1);
  }
}

sweepEverythingToTreasury();