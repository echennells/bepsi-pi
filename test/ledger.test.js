// node --test test/ledger.test.js — the sales ledger client and every listener that records a
// sale, against a fake ledger on localhost; no GPIO, LNbits or Solana RPC.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const { EventEmitter } = require("node:events");

const TOKEN = "test-ledger-token";
const TREASURY = "Treasury1111111111111111111111111111111111";
const MINT = "Mint111111111111111111111111111111111111111";
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bepsi-ledger-test-"));

// Stand-ins for hardware and network libraries, installed before anything loads them.
class FakeWebSocket extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    FakeWebSocket.last = this;
  }
}
const stubs = {
  onoff: {
    Gpio: class {
      writeSync() {}
    },
  },
  ws: FakeWebSocket,
  "@solana/web3.js": {
    assertIsAddress() {},
    createSolanaRpc: () => ({}),
    createSolanaRpcSubscriptions: () => ({}),
  },
  "@solana-program/token": { findAssociatedTokenPda: async () => [], TOKEN_PROGRAM_ADDRESS: "token" },
};
const realLoad = Module._load;
Module._load = function load(request, ...rest) {
  return Object.hasOwn(stubs, request) ? stubs[request] : realLoad.call(this, request, ...rest);
};

// The same contract as the real ledger (~/ledger/server.js on the coils Pi), which also
// takes a bearer token.
const fakeLedger = {
  rows: [],
  mode: "up", // "up" | "down" (connection reset) | "fail-after-write" (row stored, then 500)
  requests: [],
};
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  fakeLedger.requests.push({ method: req.method, path: url.pathname, headers: req.headers });
  if (fakeLedger.mode === "down") return req.socket.destroy();
  const send = (code, obj) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
  };
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: "bad token" });
  if (!url.pathname.endsWith("/purchases")) return send(404, { error: "not found" });
  if (req.method === "GET") {
    const machine = url.searchParams.get("machine");
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);
    const list = fakeLedger.rows.filter((r) => !machine || r.machine === machine).reverse().slice(0, limit);
    return send(200, { list });
  }
  let raw = "";
  req.on("data", (c) => {
    raw += c;
  });
  req.on("end", () => {
    const b = JSON.parse(raw);
    const row = { id: fakeLedger.rows.length + 1, ...b, machine: b.machine || url.searchParams.get("machine") };
    fakeLedger.rows.push(row);
    if (fakeLedger.mode === "fail-after-write") return send(500, { error: "disk I/O error" });
    send(200, { ok: true, id: row.id });
  });
});

let url;
let modules;
test.before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}/purchases`;
  Object.assign(process.env, {
    LEDGER_URL: url,
    LEDGER_TOKEN: TOKEN,
    LEDGER_QUEUE_FILE: path.join(tmpDir, "app-queue.json"),
    LIGHTNING_LNBIT_URL: "wss://lnbits.example/api/v1/ws/test",
    SOLANA_TREASURY_ADDRESS: TREASURY,
    PIN_516_NAME: "coke",
    PIN_517_NAME: "iced tea",
    PIN_518_NAME: "poppi",
    PIN_528_NAME: "beer",
    LIGHTNING_PIN_516_AMOUNT: "2000",
    LIGHTNING_PIN_528_AMOUNT: "5000",
  });
  modules = {
    ledger: require("../src/ledger"),
    machine: require("../src/machine"),
    lightning: require("../src/listeners/lightningL"),
    solana: require("../src/listeners/solanaL"),
  };
});
test.after(() => {
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
test.beforeEach(() => {
  fakeLedger.rows = [];
  fakeLedger.mode = "up";
  fakeLedger.requests = [];
});

const newLedger = (overrides = {}) =>
  modules.ledger._test.createLedger({
    url,
    token: TOKEN,
    machine: "bepsi",
    queueFile: path.join(tmpDir, `queue-${Math.random().toString(36).slice(2)}.json`),
    ...overrides,
  });

const waitFor = async (predicate, what) => {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail(`timed out waiting for ${what}`);
};

const sale = (item, extra = {}) => ({ item, currency: "sats", amount: 2000, paymentMethod: "spark", ...extra });

test("a sale is saved with the machine name and the ledger token", async () => {
  const ledger = newLedger();
  await ledger.record(sale("coke"));

  assert.strictEqual(fakeLedger.rows.length, 1);
  const row = fakeLedger.rows[0];
  assert.deepStrictEqual(
    { machine: row.machine, item: row.item, currency: row.currency, amount: row.amount, payment_method: row.payment_method },
    { machine: "bepsi", item: "coke", currency: "sats", amount: 2000, payment_method: "spark" },
  );
  assert.ok(!Number.isNaN(Date.parse(row.timestamp)));

  const health = ledger.getHealth();
  assert.strictEqual(health.ok, true);
  assert.strictEqual(health.pending, 0);
  assert.ok(health.lastSavedAt);
});

test("a sale made while the ledger is down is queued on disk and sent when it is back", async () => {
  const ledger = newLedger();
  fakeLedger.mode = "down";
  await ledger.record(sale("coke"));

  assert.strictEqual(fakeLedger.rows.length, 0);
  let health = ledger.getHealth();
  assert.strictEqual(health.ok, false);
  assert.strictEqual(health.pending, 1);
  assert.strictEqual(health.failures, 1);
  assert.match(health.lastError.message, /ECONNRESET|socket hang up/);

  fakeLedger.mode = "up";
  await ledger.tick();
  assert.strictEqual(fakeLedger.rows.length, 1);
  assert.strictEqual(fakeLedger.rows[0].item, "coke");
  health = ledger.getHealth();
  assert.strictEqual(health.ok, true);
  assert.strictEqual(health.pending, 0);
});

test("unsent sales survive an app restart", async () => {
  const queueFile = path.join(tmpDir, "restart-queue.json");
  fakeLedger.mode = "down";
  await newLedger({ queueFile }).record(sale("beer", { amount: 5000 }));
  assert.ok(fs.existsSync(queueFile));

  fakeLedger.mode = "up";
  const restarted = newLedger({ queueFile });
  assert.strictEqual(restarted.getHealth().pending, 1);
  await restarted.tick();
  assert.deepStrictEqual(fakeLedger.rows.map((r) => [r.item, r.amount]), [["beer", 5000]]);
  assert.ok(!fs.existsSync(queueFile), "the queue file is removed once it is empty");
});

test("a sale the ledger stored before failing is not saved twice", async () => {
  const ledger = newLedger();
  fakeLedger.mode = "fail-after-write";
  await ledger.record(sale("coke"));
  assert.strictEqual(fakeLedger.rows.length, 1);
  assert.strictEqual(ledger.getHealth().pending, 1);

  fakeLedger.mode = "up";
  await ledger.tick();
  assert.strictEqual(fakeLedger.rows.length, 1);
  assert.strictEqual(ledger.getHealth().pending, 0);
});

test("queued sales go in first, in order, when the next sale arrives", async () => {
  const ledger = newLedger();
  fakeLedger.mode = "down";
  await ledger.record(sale("coke"));
  await ledger.record(sale("poppi"));
  assert.strictEqual(ledger.getHealth().pending, 2);

  fakeLedger.mode = "up";
  await ledger.record(sale("beer"));
  assert.deepStrictEqual(fakeLedger.rows.map((r) => r.item), ["coke", "poppi", "beer"]);
  assert.strictEqual(ledger.getHealth().pending, 0);
});

test("a wrong token shows in health and the sale waits for a fix", async () => {
  const ledger = newLedger({ token: "wrong" });
  await ledger.record(sale("coke"));
  const health = ledger.getHealth();
  assert.strictEqual(health.ok, false);
  assert.strictEqual(health.pending, 1);
  assert.strictEqual(health.lastError.message, "HTTP 401 bad token");
});

test("with no ledger configured, sales are kept and health says so", async () => {
  const ledger = newLedger({ url: "", token: "" });
  await ledger.record(sale("coke"));
  await ledger.tick();
  const health = ledger.getHealth();
  assert.strictEqual(health.configured, false);
  assert.strictEqual(health.ok, false);
  assert.strictEqual(health.pending, 1);
  assert.strictEqual(fakeLedger.requests.length, 0);
});

test("the periodic check notices a broken ledger with no sales to send", async () => {
  const ledger = newLedger();
  await ledger.tick();
  assert.strictEqual(ledger.getHealth().ok, true);
  assert.strictEqual(fakeLedger.requests[0].method, "GET");

  const broken = newLedger({ token: "wrong" });
  await broken.tick();
  assert.strictEqual(broken.getHealth().ok, false);
  assert.strictEqual(broken.getHealth().lastError.message, "HTTP 401 bad token");
});

test("Lightning records the drink's configured price, not LNbits' relay time", async () => {
  await modules.lightning.startLightningListener();
  const ws = FakeWebSocket.last;
  assert.strictEqual(ws.url, process.env.LIGHTNING_LNBIT_URL);

  ws.emit("message", Buffer.from("516-1000"));
  ws.emit("message", Buffer.from("517-1000"));
  await waitFor(() => fakeLedger.rows.length === 2, "two Lightning rows");
  const byItem = Object.fromEntries(fakeLedger.rows.map((r) => [r.item, r]));
  assert.strictEqual(byItem.coke.amount, 2000);
  assert.strictEqual(byItem.coke.currency, "sats");
  assert.strictEqual(byItem.coke.payment_method, "lightning");
  assert.strictEqual(byItem["iced tea"].amount, null, "no LIGHTNING_PIN_517_AMOUNT, so no amount");
});

test("Solana payments are recorded", async () => {
  const transaction = {
    meta: {
      err: null,
      preTokenBalances: [{ mint: MINT, owner: TREASURY, uiTokenAmount: { amount: "5000000" } }],
      postTokenBalances: [{ mint: MINT, owner: TREASURY, uiTokenAmount: { amount: "6000003" } }],
      logMessages: ['Program log: Memo (len 13): "YVR-BEPSI:0:3"'],
    },
  };
  const watcher = {
    network: "Solana",
    symbol: "USDC",
    label: "USDC on Solana",
    mintAddress: MINT,
    decimals: 6,
    minimumPayment: 1000000n,
    rpc: { getTransaction: () => ({ send: async () => transaction }) },
    processed: new Set(),
    health: {},
  };
  const handled = await modules.solana._test.handleSignature(watcher, "sig-1", new AbortController().signal);
  assert.strictEqual(handled, true);
  await waitFor(() => fakeLedger.rows.length === 1, "the Solana row");
  const row = fakeLedger.rows[0];
  assert.deepStrictEqual(
    { item: row.item, currency: row.currency, amount: row.amount, payment_method: row.payment_method },
    { item: "poppi", currency: "USDC", amount: 1.000003, payment_method: "solana" },
  );
});

test("Discord dispenses are recorded with discord as the payment method", async () => {
  modules.machine.dispenseFromDiscord(528);
  await waitFor(() => fakeLedger.rows.length === 1, "the Discord row");
  const row = fakeLedger.rows[0];
  assert.deepStrictEqual(
    { item: row.item, currency: row.currency, amount: row.amount, payment_method: row.payment_method },
    { item: "beer", currency: "discord", amount: null, payment_method: "discord" },
  );
});

test("the app's /health includes the ledger section", () => {
  const health = modules.ledger.getLedgerHealth();
  for (const key of ["ok", "configured", "host", "machine", "pending", "lastSavedAt", "lastError", "failures"]) {
    assert.ok(key in health, `health has ${key}`);
  }
  assert.strictEqual(health.host, new URL(url).host);
  assert.strictEqual(JSON.stringify(health).includes(TOKEN), false, "the token is never in /health");
});
