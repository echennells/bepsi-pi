#!/usr/bin/env node

/**
 * Benchmark: EXPERIMENTAL APPROACH (PURE EVENTS)
 * - Sats: Events ONLY (transfer:claimed) - NO polling backup
 * - Tokens: Events ONLY (balance:updated) - NO polling backup
 * This tests pure event-driven detection without any polling safety net
 */

async function benchmarkExperimental() {
  try {
    const { IssuerSparkWallet } = await import("@buildonspark/issuer-sdk");

    const numPayments = parseInt(process.env.NUM_PAYMENTS || '5');
    const testWalletMnemonic = process.env.TEST_WALLET_MNEMONIC;
    const pinAddress = process.env.SPARK_PIN_516_ADDRESS;
    const pinMnemonic = process.env.SPARK_PIN_516_MNEMONIC;
    const tokenId = process.env.SPARK_BEPSITOKEN_IDENTIFIER;

    console.log(`🧪 EXPERIMENTAL APPROACH BENCHMARK (PURE EVENTS)`);
    console.log(`📊 Testing ${numPayments} sats payments + ${numPayments} token payments`);
    console.log(`⚡ Sats: Events ONLY (no polling) - EXPERIMENTAL`);
    console.log(`🪙 Tokens: Events ONLY (no polling) - EXPERIMENTAL\n`);

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
    let initialBalanceScanComplete = false;

    // Track baselines
    let previousSatsBalance = 0;
    let previousTokenBalance = 0;

    // EXPERIMENTAL: Sats via Events (primary)
    pinWallet.on('transfer:claimed', async (transferId) => {
      if (!initialBalanceScanComplete) return;

      const detectionTime = Date.now();
      console.log(`✅ Sats Payment detected via EVENTS (EXPERIMENTAL)! Transfer ID: ${transferId}`);

      const undetectedPayments = detectionTimes.filter(p => !p.detectedAt && p.type === 'sats');
      if (undetectedPayments.length > 0) {
        const payment = undetectedPayments[0];
        payment.detectedAt = detectionTime;
        payment.latency = detectionTime - payment.sentAt;
        payment.detectionMethod = 'events-experimental';
        console.log(`   ⏱️  Sats EXPERIMENTAL Event Detection latency for payment #${payment.paymentNum}: ${payment.latency}ms\n`);
      }
    });

    // EXPERIMENTAL: Token via Events (balance:updated)
    pinWallet.on('balance:updated', async (balanceInfo) => {
      if (!initialBalanceScanComplete) return;

      try {
        const detectionTime = Date.now();
        console.log(`🔔 Balance update event received (EXPERIMENTAL):`, balanceInfo);

        const currentBalance = await pinWallet.getBalance();
        let currentTokenBalance = 0;

        if (currentBalance.tokenBalances && currentBalance.tokenBalances.has(tokenId)) {
          const tokenData = currentBalance.tokenBalances.get(tokenId);
          if (tokenData && tokenData.balance) {
            currentTokenBalance = Number(tokenData.balance) / Math.pow(10, 6);
          }
        }

        if (currentTokenBalance > previousTokenBalance) {
          const paymentAmount = currentTokenBalance - previousTokenBalance;
          console.log(`✅ Token Payment detected via EVENTS (EXPERIMENTAL)! Amount: ${paymentAmount} tokens`);

          const undetectedPayments = detectionTimes.filter(p => !p.detectedAt && p.type === 'tokens');
          const paymentsToMark = Math.min(paymentAmount, undetectedPayments.length);

          for (let i = 0; i < paymentsToMark; i++) {
            const payment = undetectedPayments[i];
            payment.detectedAt = detectionTime;
            payment.latency = detectionTime - payment.sentAt;
            payment.detectionMethod = 'events-experimental';
            console.log(`   ⏱️  Token EXPERIMENTAL Event Detection latency for payment #${payment.paymentNum}: ${payment.latency}ms`);
          }

          previousTokenBalance = currentTokenBalance;
        }
      } catch (error) {
        console.error(`Token event detection error: ${error.message}`);
      }
    });

    // NO POLLING BACKUP - Pure events only!

    // Initialize baselines
    const initialBalance = await pinWallet.getBalance();
    previousSatsBalance = Number(initialBalance.balance);

    if (initialBalance.tokenBalances && initialBalance.tokenBalances.has(tokenId)) {
      const tokenData = initialBalance.tokenBalances.get(tokenId);
      if (tokenData && tokenData.balance) {
        previousTokenBalance = Number(tokenData.balance) / Math.pow(10, 6);
      }
    }

    console.log(`📊 Initial pin wallet sats balance: ${previousSatsBalance} sats`);
    console.log(`📊 Initial pin wallet token balance: ${previousTokenBalance} tokens\n`);

    // NO POLLING - Pure events only
    await new Promise(resolve => setTimeout(resolve, 2000));
    initialBalanceScanComplete = true;

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

    // Wait for token detection (events only, no polling)
    console.log(`\n⏳ Waiting for token payment detection via events (20 seconds)...\n`);
    await new Promise(resolve => setTimeout(resolve, 20000));

    // Calculate and display results
    console.log(`\n${"=".repeat(70)}`);
    console.log(`📊 EXPERIMENTAL BENCHMARK RESULTS (PURE EVENTS)`);
    console.log(`${"=".repeat(70)}\n`);

    const satsPayments = detectionTimes.filter(p => p.type === 'sats' && p.latency !== null);
    const tokenPayments = detectionTimes.filter(p => p.type === 'tokens' && p.latency !== null);

    if (satsPayments.length > 0) {
      const satsLatencies = satsPayments.map(p => p.latency);
      const satsAvg = satsLatencies.reduce((a, b) => a + b, 0) / satsLatencies.length;
      const satsMin = Math.min(...satsLatencies);
      const satsMax = Math.max(...satsLatencies);

      console.log(`⚡ SATS PAYMENTS (Events Only):`);
      console.log(`   Detected: ${satsPayments.length}/${numPayments}`);
      console.log(`   Average latency: ${satsAvg.toFixed(0)}ms`);
      console.log(`   Min: ${satsMin}ms, Max: ${satsMax}ms\n`);
    } else {
      console.log(`⚡ SATS PAYMENTS (Events Only):`);
      console.log(`   Detected: 0/${numPayments}`);
      console.log(`   ❌ No payments detected via events\n`);
    }

    if (tokenPayments.length > 0) {
      const tokenLatencies = tokenPayments.map(p => p.latency);
      const tokenAvg = tokenLatencies.reduce((a, b) => a + b, 0) / tokenLatencies.length;
      const tokenMin = Math.min(...tokenLatencies);
      const tokenMax = Math.max(...tokenLatencies);

      console.log(`🪙 TOKEN PAYMENTS (Events Only):`);
      console.log(`   Detected: ${tokenPayments.length}/${numPayments}`);
      console.log(`   Average latency: ${tokenAvg.toFixed(0)}ms`);
      console.log(`   Min: ${tokenMin}ms, Max: ${tokenMax}ms\n`);
    } else {
      console.log(`🪙 TOKEN PAYMENTS (Events Only):`);
      console.log(`   Detected: 0/${numPayments}`);
      console.log(`   ❌ No payments detected via events\n`);
    }

    console.log(`${"=".repeat(70)}\n`);

    // Detailed results
    console.log(`📋 Detailed Results:\n`);
    for (const payment of detectionTimes) {
      if (payment.latency) {
        const icon = payment.type === 'sats' ? '⚡' : '🪙';
        console.log(`${icon} ${payment.type.toUpperCase()} #${payment.paymentNum}: ${payment.latency}ms (📡 EVENTS ONLY)`);
      } else {
        console.log(`❌ ${payment.type.toUpperCase()} #${payment.paymentNum}: NOT DETECTED`);
      }
    }

    console.log(`\n✅ Experimental pure events benchmark complete!`);

  } catch (error) {
    console.error("❌ Benchmark failed:", error.message);
    process.exit(1);
  }
}

benchmarkExperimental();