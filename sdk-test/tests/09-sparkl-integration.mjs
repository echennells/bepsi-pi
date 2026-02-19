/**
 * Test 09 — sparkL.js Integration Test
 *
 * Tests the exact production detection logic from sparkL.js:
 *   - Event-based sats detection (transfer:claimed with updatedBalance)
 *   - Polling-based token detection (ownedBalance, tokenMetadata.decimals)
 *   - Stream disconnect warning (15min threshold)
 *   - Sweep logging (only when something swept)
 *
 * Uses Wallet B (funded) as sender, generates a fresh wallet as the "pin wallet".
 */
import { log, logSection, safeStringify } from './helpers.mjs';

const { SparkWallet } = await import('@buildonspark/spark-sdk');

const WALLET_B_MNEMONIC = process.env.SPARK_WALLET_B_MNEMONIC;

if (!WALLET_B_MNEMONIC) {
  console.error('ERROR: Set SPARK_WALLET_B_MNEMONIC in env');
  process.exit(1);
}
const TOKEN_IDENTIFIER = 'btkn1xecvlqngfwwvw2z38s67rn23r76m2vpkmwavfr9cr6ytzgqufu0ql0a4qk';

const SATS_TO_SEND = 50;
const TOKENS_TO_SEND = 1.0;
const POLL_INTERVAL_MS = 2000;
const DETECT_TIMEOUT_MS = 60000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============================================================================
// Mock dispense/log (replaces ../machine and ../payment-events)
// ============================================================================
const dispenseLog = [];
function dispenseFromPayments(pinNo, type) {
  dispenseLog.push({ action: 'dispense', pinNo, type, time: Date.now() });
}
function logPayment(pinNo, type, amount, source) {
  dispenseLog.push({ action: 'logPayment', pinNo, type, amount, source, time: Date.now() });
}
function notifyPaymentSuccess(pinNo, address, drinkName, type, amount) {
  dispenseLog.push({ action: 'notify', pinNo, drinkName, type, amount, time: Date.now() });
}

// ============================================================================
// Production sparkL.js logic (copied exactly)
// ============================================================================

const pinPaymentAddresses = new Map();
const pinWallets = new Map();
const previousSatsBalances = new Map();
const previousTokenBalances = new Map();
let initialBalanceScanComplete = false;
const satsProcessedViaEvent = new Set();
const streamDisconnectedAt = new Map();
const DISCONNECT_WARN_MS = 15 * 60 * 1000;

// This is the exact event handler from sparkL.js
function setupEventEmitterForPin(pinNo, wallet) {
  wallet.on('transfer:claimed', async (transferId, updatedBalance) => {
    if (!initialBalanceScanComplete) return;

    try {
      const currentSatsNum = updatedBalance != null
        ? Number(updatedBalance)
        : Number((await wallet.getBalance()).balance);
      const previousSats = previousSatsBalances.get(pinNo) || 0;
      const paymentRequest = pinPaymentAddresses.get(pinNo);

      if (!paymentRequest) return;

      const requiredAmount = parseInt(paymentRequest.amount);
      const satsIncrease = currentSatsNum - previousSats;

      if (currentSatsNum >= requiredAmount && currentSatsNum > previousSats) {
        log('EVENT', `SATS PAYMENT DETECTED for pin ${pinNo}! +${satsIncrease} sats (balance: ${currentSatsNum})`);

        previousSatsBalances.set(pinNo, currentSatsNum);
        satsProcessedViaEvent.add(transferId);

        logPayment(pinNo, "sats", satsIncrease, "spark");
        dispenseFromPayments(pinNo, "sats");
        notifyPaymentSuccess(pinNo, paymentRequest.address, `pin ${pinNo}`, "sats", satsIncrease);
      }
    } catch (error) {
      log('EVENT', `Error: ${error.message}`);
    }
  });

  wallet.on('stream:connected', () => {
    if (streamDisconnectedAt.has(pinNo)) {
      const downtime = Date.now() - streamDisconnectedAt.get(pinNo);
      log('STREAM', `Reconnected pin ${pinNo} (was down ${Math.round(downtime / 1000)}s)`);
      streamDisconnectedAt.delete(pinNo);
    }
  });

  wallet.on('stream:disconnected', (reason) => {
    streamDisconnectedAt.set(pinNo, Date.now());
  });
}

// This is the exact token check logic from sparkL.js
async function checkForTokenPayments() {
  for (const [pinNo, paymentRequest] of pinPaymentAddresses) {
    const wallet = pinWallets.get(pinNo);
    const currentBalance = await wallet.getBalance();
    const currentSatsNum = Number(currentBalance.balance);
    previousSatsBalances.set(pinNo, currentSatsNum);

    const tokenConfig = { identifier: TOKEN_IDENTIFIER, name: 'Bepsi Token', pinAmounts: {} };
    tokenConfig.pinAmounts[pinNo] = TOKENS_TO_SEND;

    let tokenAmount = 0;
    if (currentBalance.tokenBalances.has(tokenConfig.identifier)) {
      const tokenData = currentBalance.tokenBalances.get(tokenConfig.identifier);
      if (tokenData && tokenData.ownedBalance != null) {
        const decimals = tokenData.tokenMetadata?.decimals ?? 6;
        tokenAmount = Number(tokenData.ownedBalance) / Math.pow(10, decimals);
      }
    }

    const tokenBalanceKey = `${pinNo}_${tokenConfig.identifier}`;
    const previousTokenAmount = previousTokenBalances.get(tokenBalanceKey) || 0;

    const paymentAmount = tokenAmount - previousTokenAmount;
    if (paymentAmount >= tokenConfig.pinAmounts[pinNo] && tokenAmount > previousTokenAmount && !isNaN(tokenAmount) && initialBalanceScanComplete) {
      log('POLL', `TOKEN PAYMENT DETECTED for pin ${pinNo}! +${paymentAmount} tokens (balance: ${tokenAmount})`);
      previousTokenBalances.set(tokenBalanceKey, tokenAmount);

      const tokenIncrease = tokenAmount - previousTokenAmount;
      logPayment(pinNo, "tokens", tokenIncrease, "spark");
      dispenseFromPayments(pinNo, "tokens");
      notifyPaymentSuccess(pinNo, paymentRequest.address, `pin ${pinNo}`, "tokens", tokenIncrease);
    } else {
      previousTokenBalances.set(tokenBalanceKey, tokenAmount);
    }
  }

  if (!initialBalanceScanComplete) {
    initialBalanceScanComplete = true;
    log('INIT', 'Initial balance scan complete');
  }

  // Disconnect warning check
  for (const [pinNo, disconnectTime] of streamDisconnectedAt) {
    const downtime = Date.now() - disconnectTime;
    if (downtime >= DISCONNECT_WARN_MS) {
      log('WARN', `EventEmitter for pin ${pinNo} disconnected for ${Math.round(downtime / 60000)}min`);
    }
  }
}

// ============================================================================
// Test
// ============================================================================

async function main() {
  logSection('Test 09 — sparkL.js Integration');

  // Init sender
  log('setup', 'Initializing Wallet B (sender)...');
  const { wallet: walletB } = await SparkWallet.initialize({
    mnemonicOrSeed: WALLET_B_MNEMONIC,
    options: { network: 'MAINNET' },
  });
  log('setup', `Wallet B: ${walletB.sparkAddress}`);
  const balB = await walletB.getBalance();
  const satsB = Number(balB.balance);
  const tokensB = balB.tokenBalances.has(TOKEN_IDENTIFIER)
    ? Number(balB.tokenBalances.get(TOKEN_IDENTIFIER).ownedBalance) / 1e6
    : 0;
  log('setup', `Wallet B: ${satsB} sats, ${tokensB} BEPSI`);

  if (satsB < SATS_TO_SEND) { log('setup', 'Not enough sats'); process.exit(1); }
  if (tokensB < TOKENS_TO_SEND) { log('setup', 'Not enough tokens'); process.exit(1); }

  // Init pin wallet (fresh mnemonic — acts like a vending machine pin)
  const bip39 = await import('bip39');
  const pinMnemonic = bip39.generateMnemonic();
  log('setup', `Generated pin wallet mnemonic: ${pinMnemonic}`);

  const { wallet: pinWallet } = await SparkWallet.initialize({
    mnemonicOrSeed: pinMnemonic,
    options: { network: 'MAINNET' },
  });
  const PIN_NO = 516;
  pinWallets.set(PIN_NO, pinWallet);
  log('setup', `Pin wallet: ${pinWallet.sparkAddress}`);

  // Set up like sparkL.js does
  pinPaymentAddresses.set(PIN_NO, {
    pinNo: PIN_NO,
    address: pinWallet.sparkAddress,
    amount: SATS_TO_SEND,
  });

  setupEventEmitterForPin(PIN_NO, pinWallet);

  // Do initial balance scan (like sparkL.js startup)
  await checkForTokenPayments();
  log('setup', 'Setup complete, listening...');

  // ================================================================
  // TEST 1: Sats via event
  // ================================================================
  logSection('TEST 1: Sats Payment Detection');

  const satsStart = Date.now();
  let satsDetected = false;

  // Start polling in background
  const pollHandle = setInterval(async () => {
    await checkForTokenPayments();
  }, POLL_INTERVAL_MS);

  await sleep(1000);
  log('send', `Sending ${SATS_TO_SEND} sats B → pin wallet...`);
  await walletB.transfer({
    receiverSparkAddress: pinWallet.sparkAddress,
    amountSats: SATS_TO_SEND,
  });
  log('send', `Sent in ${Date.now() - satsStart}ms`);

  // Wait for detection
  while (!satsDetected && (Date.now() - satsStart) < DETECT_TIMEOUT_MS) {
    await sleep(500);
    if (dispenseLog.some(e => e.action === 'dispense' && e.type === 'sats')) {
      satsDetected = true;
    }
  }

  const satsLatency = dispenseLog.find(e => e.action === 'dispense' && e.type === 'sats');
  if (satsDetected) {
    log('RESULT', `SATS: PASS — detected in ${satsLatency.time - satsStart}ms`);
  } else {
    log('RESULT', 'SATS: FAIL — not detected within timeout');
  }

  await sleep(2000);

  // ================================================================
  // TEST 2: Token via polling
  // ================================================================
  logSection('TEST 2: Token Payment Detection');

  const tokenStart = Date.now();
  let tokenDetected = false;
  const dispenseCountBefore = dispenseLog.filter(e => e.action === 'dispense' && e.type === 'tokens').length;

  log('send', `Sending ${TOKENS_TO_SEND} BEPSI B → pin wallet...`);
  const rawAmount = BigInt(Math.round(TOKENS_TO_SEND * 1e6));
  await walletB.transferTokens({
    tokenIdentifier: TOKEN_IDENTIFIER,
    tokenAmount: rawAmount,
    receiverSparkAddress: pinWallet.sparkAddress,
  });
  log('send', `Sent in ${Date.now() - tokenStart}ms`);

  // Wait for detection
  while (!tokenDetected && (Date.now() - tokenStart) < DETECT_TIMEOUT_MS) {
    await sleep(500);
    if (dispenseLog.filter(e => e.action === 'dispense' && e.type === 'tokens').length > dispenseCountBefore) {
      tokenDetected = true;
    }
  }

  const tokenLatency = dispenseLog.filter(e => e.action === 'dispense' && e.type === 'tokens').pop();
  if (tokenDetected) {
    log('RESULT', `TOKENS: PASS — detected in ${tokenLatency.time - tokenStart}ms`);
  } else {
    log('RESULT', 'TOKENS: FAIL — not detected within timeout');
  }

  clearInterval(pollHandle);

  // ================================================================
  // TEST 3: Verify disconnect warning logic
  // ================================================================
  logSection('TEST 3: Disconnect Warning Logic');

  // Simulate a stale disconnect (fake 16 minutes ago)
  streamDisconnectedAt.set(PIN_NO, Date.now() - (16 * 60 * 1000));
  const warnLogBefore = dispenseLog.length;
  log('test', 'Simulated 16min disconnect, running poll cycle...');
  // Capture console output
  const origLog = console.log;
  let warnLogged = false;
  console.log = (...args) => {
    const msg = args.join(' ');
    if (msg.includes('disconnected for')) warnLogged = true;
    origLog(...args);
  };
  await checkForTokenPayments();
  console.log = origLog;

  if (warnLogged) {
    log('RESULT', 'DISCONNECT WARNING: PASS — warning logged after 15min');
  } else {
    log('RESULT', 'DISCONNECT WARNING: FAIL — no warning logged');
  }

  // Clean up
  streamDisconnectedAt.delete(PIN_NO);

  // ================================================================
  // SUMMARY
  // ================================================================
  logSection('SUMMARY');
  log('summary', `Sats detection: ${satsDetected ? 'PASS' : 'FAIL'}`);
  log('summary', `Token detection: ${tokenDetected ? 'PASS' : 'FAIL'}`);
  log('summary', `Disconnect warning: ${warnLogged ? 'PASS' : 'FAIL'}`);
  log('summary', '');
  log('summary', 'Dispense log:');
  for (const entry of dispenseLog) {
    log('summary', `  ${JSON.stringify(entry)}`);
  }

  // Send sats + tokens back to Wallet B so we don't lose funds
  logSection('CLEANUP — returning funds to Wallet B');
  try {
    const finalBal = await pinWallet.getBalance();
    const finalSats = Number(finalBal.balance);
    if (finalSats > 0) {
      log('cleanup', `Returning ${finalSats} sats to Wallet B...`);
      await pinWallet.transfer({
        receiverSparkAddress: walletB.sparkAddress,
        amountSats: finalSats,
      });
      log('cleanup', `Returned ${finalSats} sats`);
    }
    if (finalBal.tokenBalances.has(TOKEN_IDENTIFIER)) {
      const td = finalBal.tokenBalances.get(TOKEN_IDENTIFIER);
      if (td.ownedBalance > 0n) {
        log('cleanup', `Returning ${Number(td.ownedBalance) / 1e6} BEPSI to Wallet B...`);
        await pinWallet.transferTokens({
          tokenIdentifier: TOKEN_IDENTIFIER,
          tokenAmount: td.ownedBalance,
          receiverSparkAddress: walletB.sparkAddress,
        });
        log('cleanup', 'Returned tokens');
      }
    }
  } catch (e) {
    log('cleanup', `Warning: ${e.message}`);
  }

  log('summary', 'Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Test 09 fatal:', err);
  process.exit(1);
});
