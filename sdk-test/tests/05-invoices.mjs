/**
 * Test 05 — Invoice APIs (New)
 *
 * Test createSatsInvoice(), createTokensInvoice(), querySparkInvoices().
 * Could invoice-based detection replace balance polling?
 */
import {
  log, logSection, logResult, logType,
  getTestConfig, initWallet, cleanupWallet, safeStringify, enumerateWallet,
} from './helpers.mjs';

async function main() {
  logSection('Test 05 — Invoice APIs');
  const config = getTestConfig();

  log('invoices', 'Initializing wallet...');
  const { wallet } = await initWallet(config.mnemonic);

  // --- Check which invoice methods exist ---
  logSection('Available Invoice Methods');
  const methods = enumerateWallet(wallet).filter(m =>
    typeof wallet[m] === 'function' &&
    (m.toLowerCase().includes('invoice') || m.toLowerCase().includes('bolt11') || m.toLowerCase().includes('create'))
  );
  log('invoices', `Invoice-related methods: ${methods.join(', ') || 'NONE'}`);

  // --- Test createSatsInvoice ---
  logSection('createSatsInvoice()');
  if (typeof wallet.createSatsInvoice === 'function') {
    try {
      log('invoices', 'Creating sats invoice for 1000 sats...');
      const invoice = await wallet.createSatsInvoice({ amountSats: config.amount });
      log('invoices', 'Invoice created!');
      logType('Return type', invoice);
      if (typeof invoice === 'object') {
        console.log('  Keys:', Object.keys(invoice));
        console.log('  Full:', safeStringify(invoice));
      } else {
        logResult('Value', invoice);
      }
    } catch (e) {
      log('invoices', `createSatsInvoice failed: ${e.message}`);
    }
  } else if (typeof wallet.createLightningInvoice === 'function') {
    try {
      log('invoices', 'createSatsInvoice not found, trying createLightningInvoice...');
      const invoice = await wallet.createLightningInvoice({ amountSats: config.amount });
      log('invoices', 'Invoice created!');
      console.log('  Full:', safeStringify(invoice));
    } catch (e) {
      log('invoices', `createLightningInvoice failed: ${e.message}`);
    }
  } else {
    log('invoices', 'No sats invoice method found.');
  }

  // --- Test createTokensInvoice ---
  logSection('createTokensInvoice()');
  if (typeof wallet.createTokensInvoice === 'function') {
    try {
      log('invoices', `Creating token invoice for ${config.tokenAmount} ${config.tokenName}...`);
      // Try different parameter formats
      const params = {
        tokenIdentifier: config.tokenIdentifier,
        tokenAmount: config.tokenAmount,
      };
      log('invoices', `Params: ${JSON.stringify(params)}`);
      const invoice = await wallet.createTokensInvoice(params);
      log('invoices', 'Token invoice created!');
      logType('Return type', invoice);
      if (typeof invoice === 'object') {
        console.log('  Keys:', Object.keys(invoice));
        console.log('  Full:', safeStringify(invoice));
      } else {
        logResult('Value', invoice);
      }
    } catch (e) {
      log('invoices', `createTokensInvoice failed: ${e.message}`);
      log('invoices', 'Trying with BigInt amount...');
      try {
        const rawAmount = BigInt(Math.round(config.tokenAmount * 1e6));
        const invoice = await wallet.createTokensInvoice({
          tokenIdentifier: config.tokenIdentifier,
          tokenAmount: rawAmount,
        });
        log('invoices', 'Token invoice created with BigInt amount!');
        console.log('  Full:', safeStringify(invoice));
      } catch (e2) {
        log('invoices', `Also failed with BigInt: ${e2.message}`);
      }
    }
  } else {
    log('invoices', 'createTokensInvoice() not available on this wallet.');
    log('invoices', 'May need to check if it exists on a different class.');
  }

  // --- Test querySparkInvoices ---
  logSection('querySparkInvoices()');
  if (typeof wallet.querySparkInvoices === 'function') {
    try {
      log('invoices', 'Querying invoices...');
      const invoices = await wallet.querySparkInvoices();
      log('invoices', 'Query returned!');
      logType('Return type', invoices);
      if (Array.isArray(invoices)) {
        logResult('Count', invoices.length);
        if (invoices.length > 0) {
          log('invoices', 'First invoice:');
          console.log(safeStringify(invoices[0]));
        }
      } else if (typeof invoices === 'object') {
        console.log('  Keys:', Object.keys(invoices));
        console.log('  Full:', safeStringify(invoices));
      }
    } catch (e) {
      log('invoices', `querySparkInvoices failed: ${e.message}`);
    }
  } else {
    log('invoices', 'querySparkInvoices() not available.');
  }

  // --- Summary ---
  logSection('Invoice Strategy Assessment');
  const hasCreate = typeof wallet.createSatsInvoice === 'function' || typeof wallet.createLightningInvoice === 'function';
  const hasTokenCreate = typeof wallet.createTokensInvoice === 'function';
  const hasQuery = typeof wallet.querySparkInvoices === 'function';

  log('invoices', `Can create sats invoices: ${hasCreate}`);
  log('invoices', `Can create token invoices: ${hasTokenCreate}`);
  log('invoices', `Can query invoices: ${hasQuery}`);

  if (hasCreate && hasQuery) {
    log('invoices', 'VIABLE: Invoice-based detection could work!');
    log('invoices', 'Strategy: Create invoice → poll querySparkInvoices for status change');
  } else {
    log('invoices', 'Invoice-based detection not fully supported with current API.');
  }

  await cleanupWallet(wallet);
  log('invoices', 'Test 05 complete.');
}

main().catch((err) => {
  console.error('Test 05 fatal:', err);
  process.exit(1);
});
