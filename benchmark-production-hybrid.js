#!/usr/bin/env node

/**
 * Benchmark: PRODUCTION HYBRID APPROACH
 * - Sats: Events (real-time via transfer:claimed)
 * - Tokens: Polling (5-second intervals)
 * This matches the actual production code in src/listeners/sparkL.js
 */

async function benchmarkProductionHybrid() {
  try {
    const { IssuerSparkWallet } = await import("@buildonspark/issuer-sdk");

    const numPayments = parseInt(process.env.NUM_PAYMENTS || '5');
    const testWalletMnemonic = process.env.TEST_WALLET_MNEMONIC;
    const pinAddress = process.env.SPARK_PIN_516_ADDRESS;
    const pinMnemonic = process.env.SPARK_PIN_516_MNEMONIC;
    const tokenId = process.env.SPARK_BEPSITOKEN_IDENTIFIER;

    console.log(`🏭 PRODUCTION HYBRID APPROACH BENCHMARK`);
    console.log(`📊 Testing ${numPayments} sats payments + ${numPayments} token payments`);
    console.log(`⚡ Sats: Events (transfer:claimed) - PRODUCTION METHOD`);
    console.log(`🪙 Tokens: Polling (5s intervals) - PRODUCTION METHOD\n`);

    // Initialize wallets
    const { wallet: testWallet } = await IssuerSparkWallet.initialize({
      mnemonicOrSeed: testWalletMnemonic,
      options: { network: "MAINNET" }
    });

    const { wallet: pinWallet } = await IssuerSparkWallet.initialize({
      mnemonicOrSeed: pinMnemonic,
      options: { network: "MAINNET" }
    });

    console.log(`💰 Test wallet balance: ${await testWallet.getBalance().then(b => b.balance)} sats\n`);

    // Track detection times
    const detectionTimes = [];

    // PRODUCTION APPROACH: Sats via Events ONLY (no polling backup)
    pinWallet.on('transfer:claimed', async (transferId) => {
      const detectionTime = Date.now();
      console.log(`✅ Sats Payment detected via EVENTS (PRODUCTION)! Transfer ID: ${transferId}`);

      // Find matching sent payment
      const undetectedPayments = detectionTimes.filter(p => !p.detectedAt && p.type === 'sats');
      if (undetectedPayments.length > 0) {
        const payment = undetectedPayments[0];
        payment.detectedAt = detectionTime;
        payment.latency = detectionTime - payment.sentAt;
        payment.detectionMethod = 'events-production';
        console.log(`   ⏱️  Sats PRODUCTION Detection latency for payment #${payment.paymentNum}: ${payment.latency}ms\n`);
      }
    });

    // Initialize baselines
    const initialBalance = await pinWallet.getBalance();
    let previousTokenBalance = 0;

    if (initialBalance.tokenBalances && initialBalance.tokenBalances.has(tokenId)) {
      const tokenData = initialBalance.tokenBalances.get(tokenId);
      if (tokenData && tokenData.balance) {
        previousTokenBalance = Number(tokenData.balance) / Math.pow(10, 6);
      }
    }
    console.log(`📊 Initial pin wallet token balance: ${previousTokenBalance} tokens\n`);

    // PRODUCTION APPROACH: Token polling ONLY (no events)
    const checkTokenPayments = async () => {
      try {
        const balance = await pinWallet.getBalance();
        let currentTokenBalance = 0;

        if (balance.tokenBalances && balance.tokenBalances.has(tokenId)) {
          const tokenData = balance.tokenBalances.get(tokenId);
          if (tokenData && tokenData.balance) {
            currentTokenBalance = Number(tokenData.balance) / Math.pow(10, 6);
          }
        }

        if (currentTokenBalance > previousTokenBalance) {
          const detectionTime = Date.now();
          const paymentAmount = currentTokenBalance - previousTokenBalance;
          console.log(`✅ Token Payment detected via POLLING (PRODUCTION)! Amount: ${paymentAmount} tokens`);

          const undetectedPayments = detectionTimes.filter(p => !p.detectedAt && p.type === 'tokens');
          const paymentsToMark = Math.min(paymentAmount, undetectedPayments.length);

          for (let i = 0; i < paymentsToMark; i++) {
            const payment = undetectedPayments[i];
            payment.detectedAt = detectionTime;
            payment.latency = detectionTime - payment.sentAt;
            payment.detectionMethod = 'polling-production';
            console.log(`   ⏱️  Token PRODUCTION Detection latency for payment #${payment.paymentNum}: ${payment.latency}ms`);
          }

          previousTokenBalance = currentTokenBalance;
        }
      } catch (error) {
        console.error(`Token polling error: ${error.message}`);
      }
    };

    // Start polling every 5 seconds (production interval)
    const pollingInterval = setInterval(checkTokenPayments, 5000);

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Send SATS payments
    console.log(`💸 Sending ${numPayments} sats payments...\n`);

    for (let i = 0; i < numPayments; i++) {
      const sentAt = Date.now();
      try {
        const result = await testWallet.transfer({
          receiverSparkAddress: pinAddress,
          amountSats: 1000
        });

        detectionTimes.push({
          type: 'sats',
          paymentNum: i + 1,
          txId: result.id,
          sentAt,
          detectedAt: null,
          latency: null
        });

        console.log(`📤 Sats payment ${i + 1}/${numPayments} sent - TX: ${result.id}`);
        await new Promise(resolve => setTimeout(resolve, 8000));
      } catch (error) {
        console.error(`❌ Sats payment ${i + 1} failed:`, error.message);
      }
    }

    // Wait for sats detection
    console.log(`\n⏳ Waiting for sats payment detection (20 seconds)...\n`);
    await new Promise(resolve => setTimeout(resolve, 20000));

    // Send TOKEN payments
    console.log(`\n🪙 Sending ${numPayments} token payments...\n`);

    for (let i = 0; i < numPayments; i++) {
      const sentAt = Date.now();
      try {
        const rawAmount = BigInt(1 * Math.pow(10, 6)); // 1 token
        const result = await testWallet.transferTokens({
          tokenIdentifier: tokenId,
          tokenAmount: rawAmount,
          receiverSparkAddress: pinAddress
        });

        detectionTimes.push({
          type: 'tokens',
          paymentNum: i + 1,
          txId: result,
          sentAt,
          detectedAt: null,
          latency: null
        });

        console.log(`📤 Token payment ${i + 1}/${numPayments} sent - TX: ${result}`);
        await new Promise(resolve => setTimeout(resolve, 8000));
      } catch (error) {
        console.error(`❌ Token payment ${i + 1} failed:`, error.message);
      }
    }

    // Wait for token detection
    console.log(`\n⏳ Waiting for token payment detection (20 seconds)...\n`);
    await new Promise(resolve => setTimeout(resolve, 20000));

    // Stop polling
    clearInterval(pollingInterval);

    // Calculate and display results
    console.log(`\n${"=".repeat(70)}`);
    console.log(`📊 PRODUCTION HYBRID BENCHMARK RESULTS`);
    console.log(`${"=".repeat(70)}\n`);

    const satsPayments = detectionTimes.filter(p => p.type === 'sats' && p.latency !== null);
    const tokenPayments = detectionTimes.filter(p => p.type === 'tokens' && p.latency !== null);

    if (satsPayments.length > 0) {
      const satsLatencies = satsPayments.map(p => p.latency);
      const satsAvg = satsLatencies.reduce((a, b) => a + b, 0) / satsLatencies.length;
      const satsMin = Math.min(...satsLatencies);
      const satsMax = Math.max(...satsLatencies);

      console.log(`⚡ SATS PAYMENTS (Events - Production):`);
      console.log(`   Detected: ${satsPayments.length}/${numPayments}`);
      console.log(`   Average latency: ${satsAvg.toFixed(0)}ms`);
      console.log(`   Min: ${satsMin}ms, Max: ${satsMax}ms\n`);
    }

    if (tokenPayments.length > 0) {
      const tokenLatencies = tokenPayments.map(p => p.latency);
      const tokenAvg = tokenLatencies.reduce((a, b) => a + b, 0) / tokenLatencies.length;
      const tokenMin = Math.min(...tokenLatencies);
      const tokenMax = Math.max(...tokenLatencies);

      console.log(`🪙 TOKEN PAYMENTS (Polling - Production):`);
      console.log(`   Detected: ${tokenPayments.length}/${numPayments}`);
      console.log(`   Average latency: ${tokenAvg.toFixed(0)}ms`);
      console.log(`   Min: ${tokenMin}ms, Max: ${tokenMax}ms\n`);
    }

    console.log(`${"=".repeat(70)}\n`);

    // Detailed results
    console.log(`📋 Detailed Results:\n`);
    for (const payment of detectionTimes) {
      if (payment.latency) {
        const method = payment.detectionMethod === 'events-production' ? '📡 EVENTS' : '📊 POLLING';
        const icon = payment.type === 'sats' ? '⚡' : '🪙';
        console.log(`${icon} ${payment.type.toUpperCase()} #${payment.paymentNum}: ${payment.latency}ms (${method} - PRODUCTION)`);
      } else {
        console.log(`❌ ${payment.type.toUpperCase()} #${payment.paymentNum}: NOT DETECTED`);
      }
    }

    console.log(`\n✅ Production hybrid benchmark complete!`);

  } catch (error) {
    console.error("❌ Benchmark failed:", error.message);
    process.exit(1);
  }
}

benchmarkProductionHybrid();