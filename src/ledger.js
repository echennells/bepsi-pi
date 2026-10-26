const fs = require("fs");
const path = require("path");
const axios = require("axios");

// Every sale is recorded in the purchases ledger: a small SQLite service on the spiro
// coils Pi that bepsi and spiro both write to. A sale the ledger doesn't accept (ledger
// restarting, Wi-Fi blip, bad token) is kept in a queue file and retried, so it is
// recorded late instead of lost.
const REQUEST_TIMEOUT_MS = 5 * 1000;
const RETRY_INTERVAL_MS = 60 * 1000;
// With nothing to send, still check the ledger answers and accepts our token, so a broken
// ledger shows up in /health before the next sale rather than after it.
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const MAX_QUEUED = 1000;
// A retried sale may already be in the ledger (the first attempt timed out after the row
// was written), so retries look for it among this many recent rows first.
const RECENT_ROWS_FOR_DEDUP = 200;
const ERROR_LOG_EVERY_MS = 15 * 60 * 1000;

const describeError = (error) => {
  const status = error.response?.status;
  const body = error.response?.data?.error;
  if (status) return `HTTP ${status}${body ? ` ${body}` : ""}`;
  return error.code ? `${error.code} ${error.message}` : error.message;
};

const sameSale = (a, b) =>
  a.timestamp === b.timestamp && a.item === b.item && a.payment_method === b.payment_method;

const createLedger = ({ url, token, machine, queueFile }) => {
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  const configured = Boolean(url && token);
  let queue = [];
  let flushing = false;
  let timer = null;
  let lastErrorLoggedAt = 0;
  const health = {
    lastSavedAt: null,
    lastCheckAt: null,
    lastContactOk: null,
    lastError: null,
    failures: 0,
  };

  const loadQueue = () => {
    try {
      const saved = JSON.parse(fs.readFileSync(queueFile, "utf8"));
      if (Array.isArray(saved)) queue = saved;
      if (queue.length) console.log(`[Ledger] ${queue.length} unsent sale(s) loaded from ${queueFile}`);
    } catch (error) {
      if (error.code !== "ENOENT") console.error(`[Ledger] Could not read ${queueFile}:`, error.message);
    }
  };

  const saveQueue = () => {
    try {
      if (!queue.length) {
        fs.rmSync(queueFile, { force: true });
        return;
      }
      const tmp = `${queueFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(queue));
      fs.renameSync(tmp, queueFile);
    } catch (error) {
      console.error(`[Ledger] Could not save ${queueFile} (unsent sales are only in memory):`, error.message);
    }
  };

  const noteError = (error, context) => {
    const message = describeError(error);
    health.lastContactOk = false;
    health.lastError = { at: Date.now(), message };
    if (context === "sale" || Date.now() - lastErrorLoggedAt >= ERROR_LOG_EVERY_MS) {
      lastErrorLoggedAt = Date.now();
      console.error(`[Ledger] ${context === "sale" ? "Sale not saved" : "Ledger unreachable"} (${queue.length} unsent): ${message}`);
    }
  };

  const post = async (row) => {
    const response = await axios.post(url, row, { timeout: REQUEST_TIMEOUT_MS, headers });
    if (!response.data?.ok) throw new Error(`ledger answered ${JSON.stringify(response.data).slice(0, 100)}`);
    health.lastSavedAt = Date.now();
    health.lastContactOk = true;
    return response.data.id;
  };

  const recentRows = async (limit) => {
    const response = await axios.get(url, { params: { machine, limit }, timeout: REQUEST_TIMEOUT_MS, headers });
    health.lastCheckAt = Date.now();
    health.lastContactOk = true;
    return response.data?.list || [];
  };

  const enqueue = (row) => {
    queue.push(row);
    if (queue.length > MAX_QUEUED) {
      const dropped = queue.shift();
      console.error(`[Ledger] Queue full, dropped the oldest unsent sale: ${JSON.stringify(dropped)}`);
    }
    saveQueue();
  };

  // Never throws: a ledger problem must not get in the way of dispensing.
  const record = async ({ item, currency, amount, paymentMethod }) => {
    const row = {
      machine,
      item,
      currency,
      amount: amount ?? null,
      payment_method: paymentMethod,
      timestamp: new Date().toISOString(),
    };
    // Older unsent sales go first, so the ledger keeps them in order.
    if (!configured || queue.length || flushing) {
      enqueue(row);
      if (!configured) {
        console.error(`[Ledger] LEDGER_URL/LEDGER_TOKEN not set, sale kept in ${queueFile}`);
        return;
      }
      await flush();
      return;
    }
    try {
      const id = await post(row);
      console.log(`[Ledger] Saved sale #${id}: ${item} ${amount ?? ""} ${currency} via ${paymentMethod}`);
    } catch (error) {
      health.failures++;
      enqueue(row);
      noteError(error, "sale");
    }
  };

  // Sends queued sales oldest first and stops at the first failure.
  const flush = async () => {
    if (!configured || flushing || !queue.length) return;
    flushing = true;
    try {
      const existing = await recentRows(RECENT_ROWS_FOR_DEDUP);
      while (queue.length) {
        const row = queue[0];
        if (existing.some((r) => sameSale(r, row))) {
          console.log(`[Ledger] Sale from ${row.timestamp} was already saved, not sending it again`);
        } else {
          const id = await post(row);
          console.log(`[Ledger] Saved delayed sale #${id} from ${row.timestamp}: ${row.item} via ${row.payment_method}`);
        }
        queue.shift();
        saveQueue();
      }
    } catch (error) {
      health.failures++;
      noteError(error, "retry");
    } finally {
      flushing = false;
    }
  };

  const check = async () => {
    if (!configured) return;
    try {
      await recentRows(1);
    } catch (error) {
      noteError(error, "check");
    }
  };

  const tick = async () => {
    if (queue.length) await flush();
    else if (!health.lastCheckAt || Date.now() - health.lastCheckAt >= CHECK_INTERVAL_MS) await check();
  };

  const start = () => {
    if (!configured) {
      console.error("[Ledger] LEDGER_URL/LEDGER_TOKEN not set: sales will be queued but not recorded");
    } else {
      console.log(`[Ledger] Recording sales to ${new URL(url).host} as machine "${machine}"`);
    }
    tick();
    timer = setInterval(tick, RETRY_INTERVAL_MS);
    timer.unref();
  };

  const stop = () => clearInterval(timer);

  const getHealth = () => ({
    ok: configured && queue.length === 0 && health.lastContactOk === true,
    configured,
    host: configured ? new URL(url).host : null,
    machine,
    pending: queue.length,
    oldestPendingAt: queue.length ? Date.parse(queue[0].timestamp) : null,
    ...health,
  });

  loadQueue();
  return { record, flush, check, tick, start, stop, getHealth };
};

const ledger = createLedger({
  url: process.env.LEDGER_URL,
  token: process.env.LEDGER_TOKEN,
  machine: process.env.LEDGER_MACHINE || "bepsi",
  queueFile: process.env.LEDGER_QUEUE_FILE || path.join(__dirname, "..", "ledger-queue.json"),
});

module.exports = {
  recordSale: ledger.record,
  startLedger: ledger.start,
  getLedgerHealth: ledger.getHealth,
  _test: { createLedger },
};
