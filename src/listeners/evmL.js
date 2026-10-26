const { ethers } = require("ethers");
const { dispenseFromPayments, logPayment } = require("../machine");
const { VENDOR_SELECTION_TO_PIN_MAPPING, NETWORKS } = require("../constants");
const { randomPin } = require("../common");
const { PAYMENT_ADDRESS } = require("../env");

// ethers' contract.on() polls in the background and drops RPC errors on the floor: when
// polygon-rpc.com and Ankr's Optimism endpoint started demanding API keys, those two
// listeners went silent with nothing in the logs. Each network now runs its own
// eth_getLogs poll, so every failure is logged, counted and reported in /health, and the
// next RPC in the network's list takes over.
const POLL_INTERVAL_MS = 15 * 1000;
const MAX_BACKOFF_MS = 2 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20 * 1000;
// Move to the next RPC in the list after this many failed polls in a row.
const FAILURES_BEFORE_SWITCH = 2;
// Blocks per eth_getLogs call. Public RPCs cap the range (Citrea at 1000), so it shrinks
// when one refuses and only grows back up to half the size that failed.
const MAX_LOG_RANGE = 2000;
const MIN_LOG_RANGE = 10;
// Load-balanced RPCs (publicnode) can answer eth_blockNumber from a server a block ahead of
// the one that then gets the eth_getLogs ("invalid block range params"). Staying a couple of
// blocks behind avoids that race and the shallowest reorgs, at a cost of a few seconds.
const HEAD_LAG_BLOCKS = 2;
// Catching up after an outage spreads over several polls instead of one burst.
const MAX_CALLS_PER_POLL = 50;
// A payment first seen this long after it was made (after an RPC outage) is not dispensed,
// because nobody is standing at the machine any more. It is reported in /health instead,
// where the watchdog alerts, so someone can refund it or dispense by hand.
const LATE_PAYMENT_MS =
  (parseFloat(process.env.EVM_LATE_PAYMENT_MINUTES) || 10) * 60 * 1000;
const LATE_PAYMENTS_KEPT = 20;
// Catch-up after an outage goes back at most this far: anything older could not be dispensed
// anyway. Blocks beyond it are skipped and reported in /health (skippedRanges), so someone can
// check an explorer for payments in that window.
const MAX_CATCHUP_MS = LATE_PAYMENT_MS;
// Hyperliquid's public RPC serves only the last ~2-3 minutes freely and rations older
// ("archived") blocks at 3000 per day. When it refuses, jump to this many blocks behind the
// head instead of retrying the same old blocks forever.
const RECENT_BLOCKS_AFTER_REFUSAL = 50;
const SKIPPED_RANGES_KEPT = 20;
// Logs already handled, so a rescan never dispenses twice.
const PROCESSED_KEPT = 1000;
// A poll failing every 15 s would flood the log: after the first failure, repeat at most this often.
const ERROR_LOG_EVERY_MS = 15 * 60 * 1000;

const TRANSFER_TOPIC = ethers.utils.id("Transfer(address,address,uint256)");

const hex = (n) => "0x" + n.toString(16);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Only the host is logged or reported, never a key in the path or query.
const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return "?";
  }
};

// EVM_RPC_<NETWORK> (e.g. EVM_RPC_POLYGON) replaces a network's RPC list, comma-separated,
// for example with a keyed URL.
const rpcUrlsFor = (network) => {
  const override = process.env[`EVM_RPC_${network.name.toUpperCase()}`];
  if (override) {
    return override.split(",").map((u) => u.trim()).filter(Boolean);
  }
  return [network.rpc, ...(network.rpcFallbacks || [])];
};

// ethers errors embed the request URL (and with it any key); keep the code, the HTTP
// status and the RPC's own message.
const describeError = (e) => {
  let rpcMessage;
  try {
    rpcMessage = JSON.parse(e.body).error.message;
  } catch {}
  const parts = [e.code || e.name || "Error"];
  if (e.status) parts.push(`HTTP ${e.status}`);
  parts.push(rpcMessage || (e.error && e.error.message) || e.reason || e.message || String(e));
  return parts
    .join(" ")
    .replace(/https?:\/\/[^\s"',)]+/g, "<url>")
    .slice(0, 200);
};

let createProvider = (url) =>
  new ethers.providers.StaticJsonRpcProvider({ url, timeout: REQUEST_TIMEOUT_MS });

const watchers = [];

const handleStablecoinPayments = async (from, amount, network, stablecoin) => {
  const formattedAmount = ethers.utils.formatUnits(amount, stablecoin.decimals);
  const minAmount = ethers.utils.parseUnits("1", stablecoin.decimals);

  if (ethers.BigNumber.from(amount).lt(minAmount)) {
    console.log(
      `[EVM] Insufficient amount: ${formattedAmount} ${stablecoin.symbol} from ${from} on ${network.name}`,
    );
    return;
  }

  const selection = parseInt(amount.toString().slice(-1), 10);
  let pin = VENDOR_SELECTION_TO_PIN_MAPPING[selection];

  if (Number.isNaN(pin) || pin === undefined) {
    pin = randomPin();
  }

  console.log(
    `[EVM] Payment received: ${formattedAmount} ${stablecoin.symbol} on ${network.name}, dispensing pin ${pin}`,
  );

  try {
    const numericAmount = parseFloat(formattedAmount);
    logPayment(pin, stablecoin.symbol, numericAmount, "evm");
    await dispenseFromPayments(pin, stablecoin.symbol);
  } catch (error) {
    console.error(`[EVM] Dispense failed for pin ${pin}:`, error.message);
  }
};

const createWatcher = (network, paymentAddress) => {
  const urls = rpcUrlsFor(network);
  const tokensByAddress = {};
  for (const stablecoin of network.stablecoins) {
    tokensByAddress[stablecoin.address.toLowerCase()] = stablecoin;
  }
  return {
    network,
    label: network.name,
    paymentAddress,
    recipientTopic: ethers.utils.hexZeroPad(paymentAddress, 32).toLowerCase(),
    tokensByAddress,
    tokenAddresses: Object.keys(tokensByAddress),
    urls,
    urlIndex: 0,
    provider: createProvider(urls[0]),
    // Set once the current RPC refuses a log query without a token address (publicnode).
    perToken: false,
    cursor: null,
    // Estimated wall-clock time of the cursor block: when the cursor was last caught up,
    // moved forward proportionally while catching up.
    cursorAt: null,
    range: MAX_LOG_RANGE,
    rangeCap: MAX_LOG_RANGE,
    processed: new Set(),
    lastErrorLogAt: 0,
    health: {
      ok: false,
      rpcHost: hostOf(urls[0]),
      lastPollAt: null,
      lastPollError: null,
      consecutiveFailures: 0,
      rpcSwitches: 0,
      headBlock: null,
      cursorBlock: null,
      lagBlocks: null,
      lastPaymentAt: null,
      latePayments: [],
      skippedRanges: [],
    },
  };
};

const switchRpc = (w) => {
  w.urlIndex = (w.urlIndex + 1) % w.urls.length;
  w.provider = createProvider(w.urls[w.urlIndex]);
  w.range = MAX_LOG_RANGE;
  w.rangeCap = MAX_LOG_RANGE;
  w.perToken = false;
  w.health.rpcSwitches++;
  w.health.rpcHost = hostOf(w.urls[w.urlIndex]);
  console.error(`[EVM] ${w.label}: switching to ${w.health.rpcHost}`);
};

const remember = (set, key) => {
  set.add(key);
  if (set.size > PROCESSED_KEPT) {
    set.delete(set.values().next().value);
  }
};

// Moves the cursor forward without checking the blocks in between, and says so.
const skipTo = (w, newCursor, reason) => {
  const now = Date.now();
  const skipped = {
    at: now,
    network: w.label,
    fromBlock: w.cursor + 1,
    toBlock: newCursor,
    blocks: newCursor - w.cursor,
    fromTime: w.cursorAt,
    toTime: null,
    reason,
  };
  // The blocks kept for catch-up span the rest of the time up to now.
  w.cursorAt = Math.max(w.cursorAt || now, now - MAX_CATCHUP_MS);
  skipped.toTime = w.cursorAt;
  w.cursor = newCursor;
  w.health.skippedRanges = [...w.health.skippedRanges, skipped].slice(-SKIPPED_RANGES_KEPT);
  console.error(
    `[EVM] ${w.label}: NOT checked for payments: blocks ${skipped.fromBlock}-${skipped.toBlock} ` +
      `(${skipped.blocks} blocks, ~${Math.round((skipped.toTime - (skipped.fromTime || skipped.toTime)) / 60000)} min): ` +
      `${reason}. Check an explorer for payments to ${w.paymentAddress} in that window.`,
  );
};

async function handleLog(w, log) {
  const key = `${log.transactionHash}:${log.logIndex}`;
  if (log.removed || w.processed.has(key)) return;
  const stablecoin = w.tokensByAddress[String(log.address).toLowerCase()];
  if (!stablecoin) return;
  // Normally a payment is seen within one poll of being made; after an outage it may
  // be old. A failure here throws before the log counts as handled, so it is retried.
  const block = await w.provider.send("eth_getBlockByNumber", [log.blockNumber, false]);
  const paidAt = parseInt(block.timestamp, 16) * 1000;
  remember(w.processed, key);
  const from = ethers.utils.hexDataSlice(log.topics[1], 12);
  const amount = ethers.BigNumber.from(log.data);
  if (Date.now() - paidAt > LATE_PAYMENT_MS) {
    const late = {
      at: Date.now(),
      paidAt,
      network: w.label,
      symbol: stablecoin.symbol,
      amount: ethers.utils.formatUnits(amount, stablecoin.decimals),
      txHash: log.transactionHash,
    };
    w.health.latePayments = [...w.health.latePayments, late].slice(-LATE_PAYMENTS_KEPT);
    console.error(
      `[EVM] LATE payment, NOT dispensed: ${late.amount} ${late.symbol} on ${w.label} made ${Math.round(
        (late.at - paidAt) / 60000,
      )} min ago (tx ${late.txHash}); refund it or dispense by hand`,
    );
    return;
  }
  w.health.lastPaymentAt = Date.now();
  await handleStablecoinPayments(from, amount, w.network, stablecoin);
}

// Transfers to us in [from, to]. One query for any token where the RPC allows it, which is
// what matters for Hyperliquid's archive quota; publicnode insists on an address, so there
// it is one query per token. (Hyperliquid also rejects a list of token addresses.)
async function queryLogs(w, from, to, count) {
  const filter = { fromBlock: hex(from), toBlock: hex(to), topics: [TRANSFER_TOPIC, null, w.recipientTopic] };
  if (!w.perToken) {
    count();
    return w.provider.send("eth_getLogs", [filter]);
  }
  const logs = [];
  for (const address of w.tokenAddresses) {
    count();
    logs.push(...(await w.provider.send("eth_getLogs", [{ ...filter, address }])));
  }
  return logs;
}

// Handles every transfer to the payment address since the last poll, oldest first. The
// cursor only moves past ranges whose logs were all handled.
async function pollOnce(w) {
  const head = parseInt(await w.provider.send("eth_blockNumber", []), 16);
  w.health.headBlock = head;
  const safeHead = head - HEAD_LAG_BLOCKS;
  if (w.cursor === null) {
    // Only payments made after startup dispense.
    w.cursor = safeHead;
    w.cursorAt = Date.now();
  }
  // More than MAX_CATCHUP_MS behind (an outage): keep only the newest MAX_CATCHUP_MS of
  // blocks, estimating blocks per ms from how far the chain moved while we were away.
  const behindMs = Date.now() - w.cursorAt;
  if (w.cursor < safeHead && behindMs > MAX_CATCHUP_MS) {
    const keep = Math.floor(((safeHead - w.cursor) * MAX_CATCHUP_MS) / behindMs);
    skipTo(w, safeHead - keep, `more than ${MAX_CATCHUP_MS / 60000} min behind`);
  }
  const startCursor = w.cursor;
  const startCursorAt = w.cursorAt;
  let calls = 0;
  while (w.cursor < safeHead && calls < MAX_CALLS_PER_POLL) {
    const from = w.cursor + 1;
    const to = Math.min(safeHead, w.cursor + w.range);
    let logs;
    try {
      logs = await queryLogs(w, from, to, () => calls++);
    } catch (e) {
      if (!w.perToken && /specify an address/i.test(describeError(e))) {
        w.perToken = true;
        continue;
      }
      if (/archived/i.test(describeError(e))) {
        const recent = safeHead - RECENT_BLOCKS_AFTER_REFUSAL;
        if (recent > w.cursor) {
          skipTo(w, recent, `RPC refused older blocks (${describeError(e)})`);
          continue;
        }
        throw e;
      }
      // Most often the RPC's block-range cap: retry the same blocks in smaller steps.
      if (w.range > MIN_LOG_RANGE) {
        w.rangeCap = Math.max(MIN_LOG_RANGE, Math.floor(w.range / 2));
        w.range = Math.max(MIN_LOG_RANGE, Math.floor(w.range / 4));
        continue;
      }
      throw e;
    }
    const ordered = [...logs].sort(
      (a, b) =>
        parseInt(a.blockNumber, 16) - parseInt(b.blockNumber, 16) ||
        parseInt(a.logIndex, 16) - parseInt(b.logIndex, 16),
    );
    for (const log of ordered) {
      await handleLog(w, log);
    }
    w.cursor = to;
    w.range = Math.min(w.rangeCap, w.range * 2);
  }
  if (w.cursor >= safeHead) {
    w.cursorAt = Date.now();
  } else if (w.cursor > startCursor) {
    w.cursorAt =
      startCursorAt + ((w.cursor - startCursor) / (safeHead - startCursor)) * (Date.now() - startCursorAt);
  }
  w.health.cursorBlock = w.cursor;
  // Negative when a lagging RPC took over; the cursor waits for it to catch up.
  w.health.lagBlocks = Math.max(0, safeHead - w.cursor);
}

// One poll plus its bookkeeping; returns how long to wait before the next one.
async function tick(w, delayMs = POLL_INTERVAL_MS) {
  const { health } = w;
  try {
    await pollOnce(w);
    if (health.consecutiveFailures > 0) {
      console.log(
        `[EVM] ${w.label}: polling again via ${health.rpcHost} after ${health.consecutiveFailures} failed polls`,
      );
    }
    health.ok = true;
    health.lastPollAt = Date.now();
    health.lastPollError = null;
    health.consecutiveFailures = 0;
    return POLL_INTERVAL_MS;
  } catch (e) {
    const message = describeError(e);
    health.ok = false;
    health.consecutiveFailures++;
    health.lastPollError = { at: Date.now(), rpcHost: health.rpcHost, message };
    if (health.consecutiveFailures === 1 || Date.now() - w.lastErrorLogAt >= ERROR_LOG_EVERY_MS) {
      w.lastErrorLogAt = Date.now();
      console.error(
        `[EVM] ${w.label}: poll via ${health.rpcHost} failed (${health.consecutiveFailures} in a row): ${message}`,
      );
    }
    if (w.urls.length > 1 && health.consecutiveFailures % FAILURES_BEFORE_SWITCH === 0) {
      switchRpc(w);
    }
    return Math.min(delayMs * 2, MAX_BACKOFF_MS);
  }
}

async function runWatcher(w) {
  let delayMs = POLL_INTERVAL_MS;
  for (;;) {
    delayMs = await tick(w, delayMs);
    await sleep(delayMs);
  }
}

const startEvmListener = () => {
  console.log("[EVM] Starting EVM payment listener");

  Object.values(NETWORKS)
    .filter(({ implementation }) => implementation === "EVM")
    .forEach((network) => {
      const paymentAddress = network.paymentAddress || PAYMENT_ADDRESS;
      if (!paymentAddress) {
        console.error(`[EVM] ${network.name}: no payment address configured, not watching`);
        return;
      }
      const w = createWatcher(network, paymentAddress);
      for (const { symbol } of network.stablecoins) {
        console.log(`[EVM] Watching ${symbol} on ${network.name} to ${paymentAddress}`);
      }
      watchers.push(w);
      runWatcher(w).catch((e) =>
        console.error(`[EVM] ${w.label}: watcher stopped:`, e),
      );
    });
};

const getEvmHealth = () => ({
  pollIntervalSec: POLL_INTERVAL_MS / 1000,
  latePaymentMinutes: LATE_PAYMENT_MS / 60000,
  maxCatchupMinutes: MAX_CATCHUP_MS / 60000,
  watchers: watchers.map((w) => ({
    network: w.label,
    symbols: Object.values(w.tokensByAddress).map((s) => s.symbol),
    paymentAddress: w.paymentAddress,
    rpcHosts: w.urls.map(hostOf),
    queryMode: w.perToken ? "per-token" : "single",
    ...w.health,
  })),
});

module.exports = {
  startEvmListener,
  getEvmHealth,
  // For tests only.
  _test: {
    createWatcher,
    pollOnce,
    tick,
    describeError,
    HEAD_LAG_BLOCKS,
    setProviderFactory: (f) => {
      createProvider = f;
    },
  },
};
