#!/usr/bin/env node

/**
 * Run both benchmark approaches with automatic sweeping between runs
 * This ensures we have enough funds for both benchmarks
 */

const { IssuerSparkWallet } = require('@buildonspark/issuer-sdk');

async function sweepFundsToTestWallet() {
  console.log('🧹 Sweeping any stuck funds back to test wallet...');
  const testWalletAddress = process.env.TEST_WALLET_ADDRESS || 'sp1pgss8zk663885kz8ftfexlayqgyfzpj3kjued5vwkz8y9z7646779qy3rk5rpd';
  const pins = [516, 517, 518, 524, 525, 528];
  let totalSwept = 0;

  for (const pin of pins) {
    const mnemonic = process.env[`SPARK_PIN_${pin}_MNEMONIC`];
    if (!mnemonic) continue;

    try {
      const { wallet } = await IssuerSparkWallet.initialize({
        mnemonicOrSeed: mnemonic,
        options: { network: 'MAINNET' }
      });

      const balance = await wallet.getBalance();
      const sats = Number(balance.balance);

      if (sats > 0) {
        await wallet.transfer({
          receiverSparkAddress: testWalletAddress,
          amountSats: sats
        });
        console.log(`  ✅ Swept ${sats} sats from pin ${pin}`);
        totalSwept += sats;
      }

      // Also sweep tokens
      if (balance.tokenBalances && balance.tokenBalances.size > 0) {
        for (const [tokenId, tokenData] of balance.tokenBalances) {
          const rawAmount = BigInt(tokenData.balance);
          if (rawAmount > 0n) {
            await wallet.transferTokens({
              tokenIdentifier: tokenId,
              tokenAmount: rawAmount,
              receiverSparkAddress: testWalletAddress
            });
            const tokenAmount = Number(rawAmount) / Math.pow(10, 6);
            console.log(`  ✅ Swept ${tokenAmount} tokens from pin ${pin}`);
          }
        }
      }
    } catch (error) {
      console.log(`  ⚠️ Pin ${pin}: ${error.message}`);
    }
  }

  if (totalSwept > 0) {
    console.log(`💰 Total swept: ${totalSwept} sats`);
    console.log('⏳ Waiting 15 seconds for funds to settle...');
    await new Promise(resolve => setTimeout(resolve, 15000));
    console.log('✓ Ready to proceed');
  } else {
    console.log('✓ No funds to sweep');
  }
}

async function checkBalance() {
  const testWalletMnemonic = process.env.TEST_WALLET_MNEMONIC;
  if (!testWalletMnemonic) {
    throw new Error('TEST_WALLET_MNEMONIC environment variable is required');
  }

  const { wallet } = await IssuerSparkWallet.initialize({
    mnemonicOrSeed: testWalletMnemonic,
    options: { network: 'MAINNET' }
  });

  const balance = await wallet.getBalance();
  const sats = Number(balance.balance);
  let tokens = 0;

  const tokenId = process.env.SPARK_BEPSITOKEN_IDENTIFIER;
  if (balance.tokenBalances && balance.tokenBalances.has(tokenId)) {
    const tokenData = balance.tokenBalances.get(tokenId);
    if (tokenData && tokenData.balance) {
      tokens = Number(tokenData.balance) / Math.pow(10, 6);
    }
  }

  console.log(`💰 Current test wallet balance: ${sats} sats, ${tokens} tokens`);
  return { sats, tokens };
}

async function runBenchmarks() {
  try {
    console.log(`🚀 SPARK PAYMENT DETECTION COMPARISON BENCHMARK`);
    console.log(`${"=".repeat(70)}`);
    console.log(`Comparing Production vs Experimental approaches\n`);

    // Check required environment variables
    const requiredEnvVars = [
      'TEST_WALLET_MNEMONIC',
      'SPARK_PIN_516_ADDRESS',
      'SPARK_PIN_516_MNEMONIC',
      'SPARK_BEPSITOKEN_IDENTIFIER'
    ];

    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        throw new Error(`Missing required environment variable: ${envVar}`);
      }
    }

    const numPayments = process.env.NUM_PAYMENTS || '3';
    console.log(`📊 Will test ${numPayments} payments of each type for each approach\n`);

    // Initial sweep and balance check
    await sweepFundsToTestWallet();
    let { sats, tokens } = await checkBalance();

    const requiredSats = parseInt(numPayments) * 1000 * 2; // 2 runs
    const requiredTokens = parseInt(numPayments) * 2; // 2 runs

    if (sats < requiredSats) {
      throw new Error(`Insufficient sats! Need ${requiredSats} but have ${sats}`);
    }
    if (tokens < requiredTokens) {
      throw new Error(`Insufficient tokens! Need ${requiredTokens} but have ${tokens}`);
    }

    console.log(`\n${"=".repeat(70)}`);
    console.log(`🏭 RUNNING PRODUCTION HYBRID APPROACH`);
    console.log(`${"=".repeat(70)}\n`);

    // Run production hybrid benchmark
    const { spawn } = require('child_process');

    const productionEnv = {
      ...process.env,
      NUM_PAYMENTS: numPayments
    };

    const productionProcess = spawn('node', ['benchmark-production-hybrid.js'], {
      env: productionEnv,
      stdio: 'inherit'
    });

    await new Promise((resolve, reject) => {
      productionProcess.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Production benchmark failed with code ${code}`));
        } else {
          resolve();
        }
      });
    });

    console.log(`\n⏳ Sweeping funds and waiting before experimental run...\n`);

    // Sweep between runs
    await sweepFundsToTestWallet();
    ({ sats, tokens } = await checkBalance());

    console.log(`\n${"=".repeat(70)}`);
    console.log(`🧪 RUNNING EXPERIMENTAL APPROACH`);
    console.log(`${"=".repeat(70)}\n`);

    // Run experimental benchmark
    const experimentalEnv = {
      ...process.env,
      NUM_PAYMENTS: numPayments
    };

    const experimentalProcess = spawn('node', ['benchmark-experimental.js'], {
      env: experimentalEnv,
      stdio: 'inherit'
    });

    await new Promise((resolve, reject) => {
      experimentalProcess.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Experimental benchmark failed with code ${code}`));
        } else {
          resolve();
        }
      });
    });

    console.log(`\n${"=".repeat(70)}`);
    console.log(`🎯 COMPARISON BENCHMARK COMPLETE`);
    console.log(`${"=".repeat(70)}`);
    console.log(`\n✅ Both approaches tested successfully!`);
    console.log(`\n📊 Key Comparisons:`);
    console.log(`🏭 Production: Sats via Events, Tokens via Polling`);
    console.log(`🧪 Experimental: Both via Events + Polling backup`);
    console.log(`\n💡 Check the logs above to compare detection latencies and reliability.`);

    // Final cleanup sweep
    console.log(`\n🧹 Final cleanup sweep...`);
    await sweepFundsToTestWallet();

  } catch (error) {
    console.error(`❌ Benchmark comparison failed:`, error.message);
    process.exit(1);
  }
}

runBenchmarks();