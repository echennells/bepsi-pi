/**
 * Test 08 — Debug the encrypt_ecies crash
 *
 * 1. Patch the WASM encrypt_ecies at module level BEFORE any wallet init
 * 2. Generate a fresh wallet (no pending transfers)
 * 3. Init it (should work - nothing to claim)
 * 4. Send tokens from wallet B to fresh wallet (tokens work, sats don't)
 * 5. Re-init fresh wallet — this triggers claim → encrypt_ecies → crash
 * 6. Capture the exact inputs that crash
 */
import { log, logSection, safeStringify } from './helpers.mjs';
import * as bip39 from 'bip39';

// Generate a fresh mnemonic — guaranteed no pending transfers
const FRESH_MNEMONIC = bip39.generateMnemonic();

async function main() {
  logSection('Test 08 — Debug encrypt_ecies Crash');

  // Step 1: Patch the WASM encrypt_ecies at module level
  log('debug', 'Loading SDK module...');
  const sdkModule = await import('@buildonspark/spark-sdk');

  // Step 2: Init fresh wallet (no pending transfers)
  log('debug', `Fresh mnemonic: ${FRESH_MNEMONIC}`);
  const { SparkWallet } = sdkModule;

  const { wallet: freshWallet } = await SparkWallet.initialize({
    mnemonicOrSeed: FRESH_MNEMONIC,
    options: { network: 'MAINNET' },
  });
  log('debug', `Fresh wallet: ${freshWallet.sparkAddress}`);

  // Step 3: Now patch the signer's encryptEcies
  const signer = freshWallet.signingService?.signer || freshWallet.config?.signer;

  // Walk the prototype chain to find encryptEcies
  let target = signer;
  let found = false;
  while (target && !found) {
    if (typeof target.encryptEcies === 'function') {
      found = true;
      break;
    }
    target = Object.getPrototypeOf(target);
  }

  if (!found) {
    // Try finding it on the wallet directly
    const allProps = [];
    let obj = freshWallet;
    while (obj) {
      allProps.push(...Object.getOwnPropertyNames(obj));
      obj = Object.getPrototypeOf(obj);
    }
    const candidates = allProps.filter(p => p.toLowerCase().includes('sign') || p.toLowerCase().includes('frost'));
    log('debug', `Wallet signing-related props: ${candidates.join(', ')}`);

    // Try signingService.signer
    if (freshWallet.signingService) {
      const ss = freshWallet.signingService;
      log('debug', `signingService keys: ${Object.keys(ss).join(', ')}`);
      if (ss.signer) {
        const signerProto = Object.getPrototypeOf(ss.signer);
        const signerMethods = Object.getOwnPropertyNames(signerProto);
        log('debug', `signer methods: ${signerMethods.join(', ')}`);
        target = ss.signer;
        found = signerMethods.includes('encryptEcies');
      }
    }
  }

  const callLog = [];

  if (found && target) {
    const origEncrypt = target.encryptEcies.bind(target);
    target.encryptEcies = async function(msg, publicKey) {
      const callId = callLog.length + 1;
      const entry = {
        callId,
        msgLen: msg?.length,
        pkLen: publicKey?.length,
        msgHex: msg ? Buffer.from(msg).toString('hex') : 'null',
        pkHex: publicKey ? Buffer.from(publicKey).toString('hex') : 'null',
      };
      callLog.push(entry);
      log('INTERCEPT', `encrypt_ecies #${callId}: msg=${entry.msgLen}b pk=${entry.pkLen}b`);
      log('INTERCEPT', `  msg_hex: ${entry.msgHex}`);
      log('INTERCEPT', `  pk_hex:  ${entry.pkHex}`);

      try {
        const result = await origEncrypt(msg, publicKey);
        log('INTERCEPT', `  #${callId} OK: ${result.length} bytes`);
        return result;
      } catch (e) {
        log('INTERCEPT', `  #${callId} CRASHED: ${e.message}`);
        throw e;
      }
    };
    log('debug', 'Successfully patched encryptEcies!');

    // Also patch subtractSplitAndEncrypt if available
    if (typeof target.subtractSplitAndEncrypt === 'function') {
      const origSSE = target.subtractSplitAndEncrypt.bind(target);
      target.subtractSplitAndEncrypt = async function(params) {
        log('INTERCEPT', 'subtractSplitAndEncrypt called');
        log('INTERCEPT', `  receiverPK: ${params.receiverPublicKey?.length}b = ${params.receiverPublicKey ? Buffer.from(params.receiverPublicKey).toString('hex') : 'null'}`);
        try {
          const result = await origSSE(params);
          log('INTERCEPT', 'subtractSplitAndEncrypt OK');
          return result;
        } catch (e) {
          log('INTERCEPT', `subtractSplitAndEncrypt CRASHED: ${e.message}`);
          throw e;
        }
      };
      log('debug', 'Patched subtractSplitAndEncrypt too');
    }
  } else {
    log('debug', 'WARNING: Could not find encryptEcies to patch!');
  }

  // Step 4: Try to send sats from fresh wallet... wait, it has no sats
  // Instead, try to send sats TO the fresh wallet and then re-init
  // But we can't send from wallet B (also crashes)
  //
  // Alternative: just try to call encryptEcies directly with test data
  log('debug', '');
  logSection('Direct encryptEcies Test');

  if (found && target) {
    // Test with known-good inputs
    const testMsg = new Uint8Array(32).fill(0xAB);
    const testPk = Buffer.from('0261a23fa6ec0ac2299d8986274dec138ce209f27efa2790f54a68585cd8fdde8c', 'hex');

    log('debug', 'Calling encryptEcies with test data...');
    try {
      const result = await target.encryptEcies(testMsg, new Uint8Array(testPk));
      log('debug', `Direct call OK: ${result.length} bytes`);
    } catch (e) {
      log('debug', `Direct call CRASHED: ${e.message}`);
    }

    // Test many times to check for memory corruption
    log('debug', 'Running 50 consecutive encryptions...');
    for (let i = 0; i < 50; i++) {
      const msg = new Uint8Array(32);
      msg[0] = i;
      try {
        await target.encryptEcies(msg, new Uint8Array(testPk));
      } catch (e) {
        log('debug', `CRASH on iteration ${i}: ${e.message}`);
        break;
      }
    }
    log('debug', '50 consecutive encryptions done');

    // Test with larger messages
    log('debug', 'Testing with various message sizes...');
    for (const size of [16, 32, 48, 64, 128, 256, 512, 1024]) {
      const msg = new Uint8Array(size).fill(0xCD);
      try {
        await target.encryptEcies(msg, new Uint8Array(testPk));
        log('debug', `  ${size} bytes: OK`);
      } catch (e) {
        log('debug', `  ${size} bytes: CRASHED: ${e.message}`);
        break;
      }
    }
  }

  // Step 5: Now trigger the actual crash path
  // We need to cause a transfer claim. Send tokens to fresh wallet from outside.
  // But since we can't send from B (sats crash), let's try token send from B
  // (tokens worked before!)
  logSection('Triggering Claim Path');
  log('debug', 'Clean up fresh wallet and re-init to test claim...');

  // First check if wallet B can init (it has pending stuff)
  log('debug', 'Trying to init Wallet B...');
  try {
    const { wallet: walletB } = await SparkWallet.initialize({
      mnemonicOrSeed: process.env.SPARK_WALLET_B_MNEMONIC,
      options: { network: 'MAINNET' },
    });
    log('debug', `Wallet B init OK: ${walletB.sparkAddress}`);

    const bal = await walletB.getBalance();
    log('debug', `Wallet B balance: ${Number(bal.balance)} sats`);

    // Wallet B can init — try sending sats to fresh wallet
    if (Number(bal.balance) > 10) {
      log('debug', `Sending 10 sats from B to fresh wallet...`);
      try {
        await walletB.transfer({
          receiverSparkAddress: freshWallet.sparkAddress,
          amountSats: 10,
        });
        log('debug', 'Sats sent!');
      } catch (e) {
        log('debug', `Sats send failed: ${e.message}`);
      }
    }

    await walletB.cleanup();
  } catch (e) {
    log('debug', `Wallet B init failed: ${e.message}`);
    log('debug', 'Cannot trigger claim path — wallet B crashes on init');
  }

  await freshWallet.cleanup();

  logSection('Summary');
  log('debug', `Total intercepted encrypt_ecies calls: ${callLog.length}`);
  for (const c of callLog) {
    log('debug', `  #${c.callId}: msg=${c.msgLen}b pk=${c.pkLen}b OK`);
  }
  log('debug', 'Test 08 complete.');
}

main().catch((err) => {
  console.error('Test 08 fatal:', err);
  process.exit(1);
});
