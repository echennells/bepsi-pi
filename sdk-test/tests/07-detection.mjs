/**
 * Test 07 — Self-Contained Detection Test
 *
 * Wallet B (funded) sends to Wallet C (fresh).
 * Detection runs on Wallet C via events + polling simultaneously.
 * No manual intervention needed.
 *
 * Flow:
 *   1. Init both wallets
 *   2. Set up event + polling listeners on C
 *   3. Send sats B → C, race event vs polling
 *   4. Send tokens B → C, race event vs polling
 *   5. Report results
 */
import {
  log, logSection, logResult, logType,
  getTestConfig, initWallet, cleanupWallet, safeStringify,
} from './helpers.mjs';

const WALLET_B_MNEMONIC = process.env.SPARK_WALLET_B_MNEMONIC;
const WALLET_C_MNEMONIC = process.env.SPARK_WALLET_C_MNEMONIC;

if (!WALLET_B_MNEMONIC || !WALLET_C_MNEMONIC) {
  console.error('ERROR: Set SPARK_WALLET_B_MNEMONIC and SPARK_WALLET_C_MNEMONIC in env');
  process.exit(1);
}

const SATS_TO_SEND = 50;
const TOKENS_TO_SEND = 1.0; // 1 BEPSI
const POLL_INTERVAL_MS = 2000;
const DETECT_TIMEOUT_MS = 90000; // 90s max per test

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getTokenBalance(bal, tokenId) {
  if (!tokenId || !(bal.tokenBalances instanceof Map)) return 0;
  const td = bal.tokenBalances.get(tokenId);
  if (!td) return 0;
  const decimals = td.tokenMetadata?.decimals ?? 6;
  return Number(td.ownedBalance) / Math.pow(10, decimals);
}

/**
 * Listen on a wallet for a payment. Runs events + polling in parallel.
 * Resolves when EITHER method detects the payment, or timeout.
 */
function detectPayment(wallet, label, { type, tokenId }) {
  return new Promise(async (resolve) => {
    const startTime = Date.now();
    let pollCount = 0;
    let resolved = false;

    // Snapshot baseline
    const baseBal = await wallet.getBalance();
    const baseSats = Number(baseBal.balance);
    const baseTokens = getTokenBalance(baseBal, tokenId);
    log(label, `Baseline: ${baseSats} sats, ${baseTokens} tokens`);

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      result.latencyMs = Date.now() - startTime;
      clearInterval(poll);
      clearTimeout(timeout);
      resolve(result);
    };

    const timeout = setTimeout(() => {
      finish({ method: 'TIMEOUT', type });
    }, DETECT_TIMEOUT_MS);

    // --- Events ---
    wallet.on('transfer:claimed', async (...args) => {
      const eventTime = Date.now() - startTime;
      log(label, `EVENT transfer:claimed (${args.length} args) at +${eventTime}ms`);
      for (let i = 0; i < args.length; i++) {
        logType(`  arg[${i}]`, args[i]);
        if (typeof args[i] === 'object' && args[i] !== null) {
          log(label, `  arg[${i}] keys: ${Object.keys(args[i]).join(', ')}`);
          log(label, `  arg[${i}]: ${safeStringify(args[i])}`);
        }
      }

      const bal = await wallet.getBalance();
      const nowSats = Number(bal.balance);
      const nowTokens = getTokenBalance(bal, tokenId);

      if (type === 'sats' && nowSats > baseSats) {
        finish({
          method: 'event', type: 'sats', event: 'transfer:claimed',
          argCount: args.length, hasUpdatedBalance: args.length >= 2,
          increase: nowSats - baseSats, newBalance: nowSats,
        });
      }
      if (type === 'token' && nowTokens > baseTokens) {
        finish({
          method: 'event', type: 'token', event: 'transfer:claimed',
          argCount: args.length, hasUpdatedBalance: args.length >= 2,
          increase: nowTokens - baseTokens, newBalance: nowTokens,
        });
      }
    });

    // Speculative token events
    for (const ev of ['token:received', 'token:claimed', 'transfer:token']) {
      wallet.on(ev, (...args) => {
        log(label, `EVENT ${ev} (${args.length} args) at +${Date.now() - startTime}ms`);
        args.forEach((a, i) => logType(`  arg[${i}]`, a));
      });
    }

    wallet.on('stream:connected', () => log(label, `stream:connected at +${Date.now() - startTime}ms`));
    wallet.on('stream:disconnected', (r) => log(label, `stream:disconnected: ${r}`));

    // --- Polling ---
    const poll = setInterval(async () => {
      pollCount++;
      try {
        const bal = await wallet.getBalance();
        const nowSats = Number(bal.balance);
        const nowTokens = getTokenBalance(bal, tokenId);

        if (type === 'sats' && nowSats > baseSats) {
          log(label, `POLL sats: +${nowSats - baseSats} (poll #${pollCount}) at +${Date.now() - startTime}ms`);
          finish({
            method: 'polling', type: 'sats', pollNumber: pollCount,
            increase: nowSats - baseSats, newBalance: nowSats,
          });
        }
        if (type === 'token' && nowTokens > baseTokens) {
          log(label, `POLL tokens: +${nowTokens - baseTokens} (poll #${pollCount}) at +${Date.now() - startTime}ms`);
          finish({
            method: 'polling', type: 'token', pollNumber: pollCount,
            increase: nowTokens - baseTokens, newBalance: nowTokens,
            decimals: bal.tokenBalances.get(tokenId)?.tokenMetadata?.decimals,
          });
        }
      } catch (e) {
        log(label, `poll #${pollCount} error: ${e.message}`);
      }
    }, POLL_INTERVAL_MS);
  });
}

async function main() {
  logSection('Test 07 — Self-Contained Detection (B → C)');
  const config = getTestConfig();

  // Init both wallets
  log('setup', 'Initializing Wallet B (sender, funded)...');
  const { wallet: walletB } = await initWallet(WALLET_B_MNEMONIC);
  log('setup', `Wallet B: ${walletB.sparkAddress}`);

  log('setup', 'Initializing Wallet C (receiver, empty)...');
  const { wallet: walletC } = await initWallet(WALLET_C_MNEMONIC);
  log('setup', `Wallet C: ${walletC.sparkAddress}`);

  // Check B's funds
  const balB = await walletB.getBalance();
  const satsB = Number(balB.balance);
  const tokensB = getTokenBalance(balB, config.tokenIdentifier);
  log('setup', `Wallet B: ${satsB} sats, ${tokensB} tokens`);

  if (satsB < SATS_TO_SEND) {
    log('setup', `ERROR: Wallet B only has ${satsB} sats, need ${SATS_TO_SEND}`);
    process.exit(1);
  }

  // ================================================================
  // TEST 1: Sats B → C
  // ================================================================
  logSection('TEST 1: Sats Detection (B → C)');

  // Start listening BEFORE sending
  const satsDetection = detectPayment(walletC, 'C-sats', {
    type: 'sats', tokenId: config.tokenIdentifier,
  });

  // Small delay to let stream connect
  await sleep(2000);

  log('send', `Sending ${SATS_TO_SEND} sats from B → C...`);
  const satsSendStart = Date.now();
  try {
    const result = await walletB.transfer({
      receiverSparkAddress: walletC.sparkAddress,
      amountSats: SATS_TO_SEND,
    });
    log('send', `Sent in ${Date.now() - satsSendStart}ms`);
    if (result) log('send', `Result: ${safeStringify(result)}`);
  } catch (e) {
    log('send', `Send failed: ${e.message}`);
  }

  const satsResult = await satsDetection;
  logSection('SATS RESULT');
  console.log(safeStringify(satsResult));

  await sleep(3000);

  // ================================================================
  // TEST 2: Tokens B → C
  // ================================================================
  if (tokensB >= TOKENS_TO_SEND && config.tokenIdentifier) {
    logSection('TEST 2: Token Detection (B → C)');

    // Start listening BEFORE sending
    const tokenDetection = detectPayment(walletC, 'C-token', {
      type: 'token', tokenId: config.tokenIdentifier,
    });

    await sleep(2000);

    const rawAmount = BigInt(Math.round(TOKENS_TO_SEND * 1e6));
    log('send', `Sending ${TOKENS_TO_SEND} BEPSI (raw: ${rawAmount}) from B → C...`);
    const tokenSendStart = Date.now();
    try {
      const result = await walletB.transferTokens({
        tokenIdentifier: config.tokenIdentifier,
        tokenAmount: rawAmount,
        receiverSparkAddress: walletC.sparkAddress,
      });
      log('send', `Sent in ${Date.now() - tokenSendStart}ms`);
      if (result) log('send', `Result: ${safeStringify(result)}`);
    } catch (e) {
      log('send', `Token send failed: ${e.message}`);
    }

    const tokenResult = await tokenDetection;
    logSection('TOKEN RESULT');
    console.log(safeStringify(tokenResult));
  } else {
    logSection('TEST 2: Token Detection — SKIPPED');
    log('skip', `Wallet B has ${tokensB} tokens, need ${TOKENS_TO_SEND}`);
  }

  // ================================================================
  // SUMMARY
  // ================================================================
  logSection('SUMMARY');
  log('summary', 'API changes from production (issuer-sdk 0.0.99):');
  log('summary', `  Address format: ${walletC.sparkAddress.slice(0, 10)}... (was sp1...)`);
  log('summary', `  balance.balance: bigint (was string)`);
  log('summary', `  tokenData.balance → tokenData.ownedBalance (bigint)`);
  log('summary', `  tokenData.decimals → tokenData.tokenMetadata.decimals`);
  log('summary', `  decimals now correctly returns 6 for BEPSI`);
  log('summary', '');
  log('summary', 'Detection results — see TEST 1 and TEST 2 above');

  await cleanupWallet(walletB);
  await cleanupWallet(walletC);
  log('summary', 'Done.');
}

main().catch((err) => {
  console.error('Test 07 fatal:', err);
  process.exit(1);
});
