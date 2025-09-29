#!/usr/bin/env node

/**
 * Benchmark: EXPERIMENTAL APPROACH
 * - Sats: Events (transfer:claimed) + Polling backup
 * - Tokens: Events (balance:updated) + Polling backup
 * This is the experimental approach from the GitHub workflow
 */

async function benchmarkExperimental() {
  try {
    const { IssuerSparkWallet } = await import("@buildonspark/issuer-sdk");

    const numPayments = parseInt(process.env.NUM_PAYMENTS || '5');
    const testWalletMnemonic = process.env.TEST_WALLET_MNEMONIC;
    const pinAddress = process.env.SPARK_PIN_516_ADDRESS;
    const pinMnemonic = process.env.SPARK_PIN_516_MNEMONIC;
    const tokenId = process.env.SPARK_BEPSITOKEN_IDENTIFIER;

    console.log(`🧪 EXPERIMENTAL APPROACH BENCHMARK`);
    console.log(`📊 Testing ${numPayments} sats payments + ${numPayments} token payments`);
    console.log(`⚡ Sats: Events + Polling backup - EXPERIMENTAL`);
    console.log(`🪙 Tokens: Events + Polling backup - EXPERIMENTAL\n`);

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

    // EXPERIMENTAL: Polling backup for both sats and tokens
    const checkPaymentsPolling = async () => {
      try {
        const balance = await pinWallet.getBalance();
        const currentSatsBalance = Number(balance.balance);

        // Check for sats payments via polling (backup)
        if (currentSatsBalance > previousSatsBalance) {
          const detectionTime = Date.now();
          const paymentAmount = currentSatsBalance - previousSatsBalance;
          console.log(`⚠️ Sats Payment detected via POLLING BACKUP (EXPERIMENTAL)! Amount: ${paymentAmount} sats`);

          const undetectedPayments = detectionTimes.filter(p => !p.detectedAt && p.type === 'sats');
          const satsPerPayment = 1000;
          const paymentsToMark = Math.min(Math.floor(paymentAmount / satsPerPayment), undetectedPayments.length);

          for (let i = 0; i < paymentsToMark; i++) {
            const payment = undetectedPayments[i];
            payment.detectedAt = detectionTime;
            payment.latency = detectionTime - payment.sentAt;
            payment.detectionMethod = 'polling-experimental';
            console.log(`   ⏱️  Sats EXPERIMENTAL Polling Backup latency for payment #${payment.paymentNum}: ${payment.latency}ms`);
          }

          previousSatsBalance = currentSatsBalance;
        }

        // Check for token payments via polling (backup)
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
          console.log(`✅ Token Payment detected via POLLING BACKUP (EXPERIMENTAL)! Amount: ${paymentAmount} tokens`);

          const undetectedPayments = detectionTimes.filter(p => !p.detectedAt && p.type === 'tokens');
          const paymentsToMark = Math.min(paymentAmount, undetectedPayments.length);

          for (let i = 0; i < paymentsToMark; i++) {
            const payment = undetectedPayments[i];
            payment.detectedAt = detectionTime;
            payment.latency = detectionTime - payment.sentAt;
            payment.detectionMethod = 'polling-experimental';
            console.log(`   ⏱️  Token EXPERIMENTAL Polling Backup latency for payment #${payment.paymentNum}: ${payment.latency}ms`);
          }

          previousTokenBalance = currentTokenBalance;
        }
      } catch (error) {
        console.error(`Experimental polling error: ${error.message}`);
      }
    };

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

    // Start polling every 5 seconds (backup)
    const pollingInterval = setInterval(checkPaymentsPolling, 5000);

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

    // Wait for token detection
    console.log(`\n⏳ Waiting for token payment detection (20 seconds)...\n`);
    await new Promise(resolve => setTimeout(resolve, 20000));

    // Stop polling
    clearInterval(pollingInterval);

    // Calculate and display results
    console.log(`\n${"=".repeat(70)}`);
    console.log(`📊 EXPERIMENTAL BENCHMARK RESULTS`);
    console.log(`${"=".repeat(70)}\n`);

    const satsPayments = detectionTimes.filter(p => p.type === 'sats' && p.latency !== null);
    const tokenPayments = detectionTimes.filter(p => p.type === 'tokens' && p.latency !== null);

    // Separate by detection method
    const satsEventPayments = satsPayments.filter(p => p.detectionMethod === 'events-experimental');
    const satsPollingPayments = satsPayments.filter(p => p.detectionMethod === 'polling-experimental');
    const tokenEventPayments = tokenPayments.filter(p => p.detectionMethod === 'events-experimental');
    const tokenPollingPayments = tokenPayments.filter(p => p.detectionMethod === 'polling-experimental');

    if (satsPayments.length > 0) {
      console.log(`⚡ SATS PAYMENTS (Experimental):`);
      console.log(`   Total Detected: ${satsPayments.length}/${numPayments}`);
      console.log(`   📡 Event Detection: ${satsEventPayments.length} payments`);
      console.log(`   📊 Polling Backup: ${satsPollingPayments.length} payments`);

      if (satsEventPayments.length > 0) {
        const eventLatencies = satsEventPayments.map(p => p.latency);
        const eventAvg = eventLatencies.reduce((a, b) => a + b, 0) / eventLatencies.length;
        console.log(`   📡 Event Avg Latency: ${eventAvg.toFixed(0)}ms`);
      }

      if (satsPollingPayments.length > 0) {
        const pollingLatencies = satsPollingPayments.map(p => p.latency);
        const pollingAvg = pollingLatencies.reduce((a, b) => a + b, 0) / pollingLatencies.length;
        console.log(`   📊 Polling Avg Latency: ${pollingAvg.toFixed(0)}ms`);
      }
      console.log();
    }

    if (tokenPayments.length > 0) {
      console.log(`🪙 TOKEN PAYMENTS (Experimental):`);
      console.log(`   Total Detected: ${tokenPayments.length}/${numPayments}`);
      console.log(`   📡 Event Detection: ${tokenEventPayments.length} payments`);
      console.log(`   📊 Polling Backup: ${tokenPollingPayments.length} payments`);

      if (tokenEventPayments.length > 0) {
        const eventLatencies = tokenEventPayments.map(p => p.latency);
        const eventAvg = eventLatencies.reduce((a, b) => a + b, 0) / eventLatencies.length;
        console.log(`   📡 Event Avg Latency: ${eventAvg.toFixed(0)}ms`);
      }

      if (tokenPollingPayments.length > 0) {
        const pollingLatencies = tokenPollingPayments.map(p => p.latency);
        const pollingAvg = pollingLatencies.reduce((a, b) => a + b, 0) / pollingLatencies.length;
        console.log(`   📊 Polling Avg Latency: ${pollingAvg.toFixed(0)}ms`);
      }
      console.log();
    }

    console.log(`${"=".repeat(70)}\n`);

    // Detailed results
    console.log(`📋 Detailed Results:\n`);
    for (const payment of detectionTimes) {
      if (payment.latency) {
        const method = payment.detectionMethod === 'events-experimental' ? '📡 EVENTS' : '📊 POLLING';
        const icon = payment.type === 'sats' ? '⚡' : '🪙';
        console.log(`${icon} ${payment.type.toUpperCase()} #${payment.paymentNum}: ${payment.latency}ms (${method} - EXPERIMENTAL)`);
      } else {
        console.log(`❌ ${payment.type.toUpperCase()} #${payment.paymentNum}: NOT DETECTED`);
      }
    }

    console.log(`\n✅ Experimental benchmark complete!`);

  } catch (error) {
    console.error("❌ Benchmark failed:", error.message);
    process.exit(1);
  }
}

benchmarkExperimental();