#!/usr/bin/env node

/**
 * Simple benchmark: Events vs Polling for SATS
 * Both methods run simultaneously to see which detects payments first
 */

async function benchmarkSatsRace() {
  try {
    const { IssuerSparkWallet } = await import("@buildonspark/issuer-sdk");

    const numPayments = parseInt(process.env.NUM_PAYMENTS || '5');
    const testWalletMnemonic = process.env.TEST_WALLET_MNEMONIC;
    const testWalletAddress = process.env.TEST_WALLET_ADDRESS;
    const pinAddress = process.env.SPARK_PIN_516_ADDRESS;
    const pinMnemonic = process.env.SPARK_PIN_516_MNEMONIC;

    console.log(`🏁 SATS DETECTION RACE: Events vs Polling`);
    console.log(`📊 Testing ${numPayments} payments\n`);

    // First sweep any funds stuck in pin wallet back to test wallet
    console.log(`🧹 Sweeping pin wallet before test...`);
    const { wallet: pinWalletTemp } = await IssuerSparkWallet.initialize({
      mnemonicOrSeed: pinMnemonic,
      options: { network: "MAINNET" }
    });

    const pinBalanceTemp = await pinWalletTemp.getBalance();
    const pinSatsTemp = Number(pinBalanceTemp.balance);

    if (pinSatsTemp > 0) {
      try {
        await pinWalletTemp.transfer({
          receiverSparkAddress: testWalletAddress,
          amountSats: pinSatsTemp
        });
        console.log(`✅ Swept ${pinSatsTemp} sats from pin wallet back to test wallet`);
        console.log(`⏳ Waiting 15 seconds for sweep to settle...\n`);
        await new Promise(resolve => setTimeout(resolve, 15000));
      } catch (error) {
        console.log(`⚠️ Could not sweep: ${error.message}\n`);
      }
    } else {
      console.log(`✅ Pin wallet is empty\n`);
    }

    // Initialize wallets
    const { wallet: testWallet } = await IssuerSparkWallet.initialize({
      mnemonicOrSeed: testWalletMnemonic,
      options: { network: "MAINNET" }
    });

    const { wallet: pinWallet } = await IssuerSparkWallet.initialize({
      mnemonicOrSeed: pinMnemonic,
      options: { network: "MAINNET" }
    });

    // Check and display initial balance
    const initialTestBalance = await testWallet.getBalance();
    const testSats = Number(initialTestBalance.balance);
    console.log(`💰 Test wallet balance: ${testSats} sats`);

    const requiredSats = numPayments * 1000;
    if (testSats < requiredSats) {
      console.log(`❌ Insufficient balance! Need ${requiredSats} sats but only have ${testSats}`);
      process.exit(1);
    }
    console.log(`✅ Sufficient balance for ${numPayments} payments\n`);

    const payments = [];
    let previousBalance = Number((await pinWallet.getBalance()).balance);
    console.log(`📊 Initial pin balance: ${previousBalance} sats\n`);

    // Set up EVENT detection
    pinWallet.on('transfer:claimed', async (transferId) => {
      const detectionTime = Date.now();

      // Find first undetected payment
      const undetected = payments.find(p => !p.eventDetectedAt && !p.pollingDetectedAt);
      if (undetected) {
        undetected.eventDetectedAt = detectionTime;
        undetected.eventLatency = detectionTime - undetected.sentAt;
        console.log(`📡 EVENT detected payment #${undetected.num} - ${undetected.eventLatency}ms`);
      }
    });

    // Set up POLLING detection (check every second for fair comparison)
    const pollingInterval = setInterval(async () => {
      try {
        const balance = await pinWallet.getBalance();
        const currentBalance = Number(balance.balance);

        if (currentBalance > previousBalance) {
          const detectionTime = Date.now();
          const increase = currentBalance - previousBalance;

          // Find undetected payments
          const undetected = payments.filter(p => !p.eventDetectedAt && !p.pollingDetectedAt);
          const paymentsToMark = Math.floor(increase / 1000); // 1000 sats per payment

          for (let i = 0; i < Math.min(paymentsToMark, undetected.length); i++) {
            const payment = undetected[i];
            payment.pollingDetectedAt = detectionTime;
            payment.pollingLatency = detectionTime - payment.sentAt;
            console.log(`📊 POLLING detected payment #${payment.num} - ${payment.pollingLatency}ms`);
          }

          previousBalance = currentBalance;
        }
      } catch (error) {
        console.error(`Polling error: ${error.message}`);
      }
    }, 1000); // Poll every 1 second

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Send payments
    console.log(`💸 Sending ${numPayments} sats payments...\n`);

    for (let i = 0; i < numPayments; i++) {
      const sentAt = Date.now();
      try {
        const result = await testWallet.transfer({
          receiverSparkAddress: pinAddress,
          amountSats: 1000
        });

        payments.push({
          num: i + 1,
          txId: result.id,
          sentAt,
          eventDetectedAt: null,
          eventLatency: null,
          pollingDetectedAt: null,
          pollingLatency: null
        });

        console.log(`📤 Payment ${i + 1}/${numPayments} sent - TX: ${result.id}`);

        // Longer wait between payments to ensure settlement
        if (i < numPayments - 1) {
          console.log(`⏳ Waiting 15 seconds before next payment...\n`);
          await new Promise(resolve => setTimeout(resolve, 15000));
        }
      } catch (error) {
        console.error(`❌ Payment ${i + 1} failed:`, error.message);
      }
    }

    // Wait for detection
    console.log(`\n⏳ Waiting 20 seconds for all detections...\n`);
    await new Promise(resolve => setTimeout(resolve, 20000));

    clearInterval(pollingInterval);

    // Results
    console.log(`\n${"=".repeat(70)}`);
    console.log(`🏁 RACE RESULTS`);
    console.log(`${"=".repeat(70)}\n`);

    let eventWins = 0;
    let pollingWins = 0;
    let eventTotalLatency = 0;
    let pollingTotalLatency = 0;
    let eventDetected = 0;
    let pollingDetected = 0;

    for (const payment of payments) {
      console.log(`Payment #${payment.num}:`);

      if (payment.eventLatency !== null) {
        console.log(`  📡 Event: ${payment.eventLatency}ms`);
        eventTotalLatency += payment.eventLatency;
        eventDetected++;
      } else {
        console.log(`  📡 Event: NOT DETECTED`);
      }

      if (payment.pollingLatency !== null) {
        console.log(`  📊 Polling: ${payment.pollingLatency}ms`);
        pollingTotalLatency += payment.pollingLatency;
        pollingDetected++;
      } else {
        console.log(`  📊 Polling: NOT DETECTED`);
      }

      // Who won?
      if (payment.eventLatency !== null && payment.pollingLatency !== null) {
        if (payment.eventLatency < payment.pollingLatency) {
          console.log(`  🏆 EVENT WINS by ${payment.pollingLatency - payment.eventLatency}ms`);
          eventWins++;
        } else {
          console.log(`  🏆 POLLING WINS by ${payment.eventLatency - payment.pollingLatency}ms`);
          pollingWins++;
        }
      }
      console.log();
    }

    console.log(`${"=".repeat(70)}`);
    console.log(`📊 SUMMARY:`);
    console.log(`${"=".repeat(70)}\n`);

    console.log(`Detection Rate:`);
    console.log(`  📡 Events: ${eventDetected}/${numPayments} detected`);
    console.log(`  📊 Polling: ${pollingDetected}/${numPayments} detected\n`);

    if (eventDetected > 0) {
      console.log(`Average Latency:`);
      console.log(`  📡 Events: ${(eventTotalLatency / eventDetected).toFixed(0)}ms`);
      if (pollingDetected > 0) {
        console.log(`  📊 Polling: ${(pollingTotalLatency / pollingDetected).toFixed(0)}ms`);
      }
      console.log();
    }

    console.log(`Head-to-Head Wins:`);
    console.log(`  📡 Events won: ${eventWins} times`);
    console.log(`  📊 Polling won: ${pollingWins} times`);

    if (eventWins > pollingWins) {
      console.log(`\n🏆 EVENTS ARE FASTER!`);
    } else if (pollingWins > eventWins) {
      console.log(`\n🏆 POLLING IS FASTER!`);
    } else {
      console.log(`\n🤝 IT'S A TIE!`);
    }

  } catch (error) {
    console.error("❌ Benchmark failed:", error.message);
    process.exit(1);
  }
}

benchmarkSatsRace();