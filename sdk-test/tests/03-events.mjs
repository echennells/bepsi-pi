/**
 * Test 03 — Events
 *
 * Register listeners for all known and speculative events.
 * Run for 2 minutes, log everything that fires.
 * Key question: does transfer:claimed now pass (transferId, updatedBalance)?
 */
import {
  log, logSection, logType,
  getTestConfig, initWallet, cleanupWallet, safeStringify,
} from './helpers.mjs';

const LISTEN_DURATION_MS = 2 * 60 * 1000; // 2 minutes

// All events to listen for — known + speculative
const EVENTS = [
  // Known from current production code
  'transfer:claimed',
  'stream:connected',
  'stream:disconnected',
  // Speculative — might exist in new SDK
  'stream:reconnecting',
  'deposit:confirmed',
  'token:received',
  'token:claimed',
  'transfer:token',
  'invoice:paid',
  'invoice:settled',
  'payment:received',
  'balance:updated',
];

async function main() {
  logSection('Test 03 — Event Listeners');
  const config = getTestConfig();

  log('events', 'Initializing wallet...');
  const { wallet } = await initWallet(config.mnemonic);
  log('events', `Wallet address: ${wallet.sparkAddress}`);

  // Track what fires
  const eventLog = [];

  // Register listeners for every event
  for (const eventName of EVENTS) {
    try {
      wallet.on(eventName, (...args) => {
        const entry = {
          event: eventName,
          time: new Date().toISOString(),
          argCount: args.length,
          args: args.map((a, i) => ({
            index: i,
            typeof: typeof a,
            isNull: a === null,
            isUndefined: a === undefined,
            constructor: a?.constructor?.name,
            value: typeof a === 'object' ? safeStringify(a) : String(a),
          })),
        };
        eventLog.push(entry);

        log('EVENT', `>>> ${eventName} fired with ${args.length} arg(s)`);
        args.forEach((arg, i) => {
          logType(`  arg[${i}]`, arg);
          if (typeof arg === 'object' && arg !== null) {
            console.log(`  arg[${i}] keys:`, Object.keys(arg));
            console.log(`  arg[${i}] value:`, safeStringify(arg));
          }
        });
      });
      log('events', `Registered listener: ${eventName}`);
    } catch (e) {
      log('events', `Failed to register ${eventName}: ${e.message}`);
    }
  }

  // Also check if wallet has eventNames() or listenerCount()
  logSection('Event Emitter Introspection');
  if (typeof wallet.eventNames === 'function') {
    log('events', `wallet.eventNames(): ${JSON.stringify(wallet.eventNames())}`);
  } else {
    log('events', 'wallet.eventNames() not available');
  }
  if (typeof wallet.listenerCount === 'function') {
    for (const e of EVENTS) {
      const count = wallet.listenerCount(e);
      if (count > 0) log('events', `  ${e}: ${count} listener(s)`);
    }
  }

  // --- Wait and listen ---
  logSection(`Listening for ${LISTEN_DURATION_MS / 1000}s`);
  log('events', `Send sats to ${wallet.sparkAddress} to trigger transfer:claimed`);
  log('events', 'Press Ctrl+C to stop early.\n');

  // Status every 30s
  const statusInterval = setInterval(() => {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const remaining = Math.round((LISTEN_DURATION_MS - (Date.now() - startTime)) / 1000);
    log('events', `Status: ${eventLog.length} event(s) captured, ${remaining}s remaining`);
  }, 30000);

  const startTime = Date.now();

  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, LISTEN_DURATION_MS);

    process.on('SIGINT', () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  clearInterval(statusInterval);

  // --- Summary ---
  logSection('Event Summary');
  if (eventLog.length === 0) {
    log('events', 'No events fired during the listening period.');
    log('events', 'This is expected if no payments were sent.');
    log('events', 'Stream lifecycle events (connected/disconnected) should fire though — check if event names changed.');
  } else {
    log('events', `Total events captured: ${eventLog.length}`);
    const byType = {};
    for (const e of eventLog) {
      byType[e.event] = (byType[e.event] || 0) + 1;
    }
    for (const [name, count] of Object.entries(byType)) {
      log('events', `  ${name}: ${count}x`);
    }

    // Detail on transfer:claimed if it fired
    const transferEvents = eventLog.filter(e => e.event === 'transfer:claimed');
    if (transferEvents.length > 0) {
      logSection('transfer:claimed Details');
      for (const te of transferEvents) {
        log('events', `Fired at ${te.time} with ${te.argCount} arg(s):`);
        for (const arg of te.args) {
          log('events', `  arg[${arg.index}]: typeof=${arg.typeof}, constructor=${arg.constructor}`);
          log('events', `  value: ${arg.value}`);
        }
      }
      log('events', '\nKEY FINDING: transfer:claimed passes ' +
        `${transferEvents[0].argCount} argument(s) (production expects 1: transferId)`);
      if (transferEvents[0].argCount >= 2) {
        log('events', 'NEW: Second argument exists — likely updatedBalance!');
      }
    }
  }

  await cleanupWallet(wallet);
  log('events', 'Test 03 complete.');
}

main().catch((err) => {
  console.error('Test 03 fatal:', err);
  process.exit(1);
});
