// node --test test/  — the EVM listener against a fake RPC; no network, GPIO or ledger.
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

// Stand-ins for the GPIO/ledger module, installed before the listener loads it.
const calls = { dispensed: [], logged: [] };
const machinePath = path.join(__dirname, "..", "src", "machine.js");
require.cache[machinePath] = {
  id: machinePath,
  filename: machinePath,
  loaded: true,
  exports: {
    dispenseFromPayments: async (pin, currency) => calls.dispensed.push({ pin, currency }),
    logPayment: (pin, currency, amount, method) => calls.logged.push({ pin, currency, amount, method }),
  },
};
process.env.PAYMENT_ADDRESS = process.env.PAYMENT_ADDRESS || "0xdcFec2D0A98160ed5E4D10b6e1e21469d0B5e609";

const { ethers } = require("ethers");
const { _test } = require("../src/listeners/evmL");
const LAG = _test.HEAD_LAG_BLOCKS;

const PAY_TO = "0x00000000000000000000000000000000000000bb";
const USDC = "0x00000000000000000000000000000000000000a1";
const USDT = "0x00000000000000000000000000000000000000a2";
const TRANSFER = ethers.utils.id("Transfer(address,address,uint256)");
const hex = (n) => "0x" + n.toString(16);
const pad = (a) => ethers.utils.hexZeroPad(a, 32).toLowerCase();

const network = () => ({
  name: "Testnet",
  implementation: "EVM",
  rpc: "https://rpc-a.example/v2/SECRETKEY123",
  rpcFallbacks: ["https://rpc-b.example"],
  stablecoins: [
    { symbol: "USDC", decimals: 6, address: USDC },
    { symbol: "USDT", decimals: 6, address: USDT },
  ],
});

// A minimal JSON-RPC chain: blocks are 2 s apart and the head was mined just now.
const fakeChain = (opts = {}) => {
  const chain = {
    head: 1000,
    logs: [],
    fail: null,
    maxRange: Infinity,
    requests: [],
    filters: [],
    archivedBelowDepth: null,
    requireAddress: false,
    blockTime: null,
    ...opts,
  };
  chain.provider = {
    send: async (method, params) => {
      chain.requests.push(method);
      if (chain.fail) throw chain.fail;
      if (method === "eth_blockNumber") return hex(chain.head);
      if (method === "eth_getBlockByNumber") {
        const n = parseInt(params[0], 16);
        const t = chain.blockTime ? chain.blockTime(n) : Math.floor(Date.now() / 1000) - (chain.head - n) * 2;
        return { number: params[0], timestamp: hex(t) };
      }
      if (method === "eth_getLogs") {
        const f = params[0];
        chain.filters.push(f);
        if (chain.requireAddress && f.address === undefined) {
          const e = new Error("processing response error");
          e.code = "SERVER_ERROR";
          e.body = JSON.stringify({ error: { code: -32701, message: "Please specify an address in your request or, to remove restrictions, order a dedicated full node" } });
          throw e;
        }
        if (Array.isArray(f.address)) {
          const e = new Error("processing response error");
          e.code = "SERVER_ERROR";
          e.body = JSON.stringify({ error: { code: -32602, message: "Invalid params" } });
          throw e;
        }
        const from = parseInt(f.fromBlock, 16);
        const to = parseInt(f.toBlock, 16);
        if (chain.archivedBelowDepth !== null && from < chain.head - chain.archivedBelowDepth) {
          const e = new Error("processing response error");
          e.code = "SERVER_ERROR";
          e.body = JSON.stringify({ error: { code: -32603, message: "More than 3000 archived blocks queried in one day" } });
          throw e;
        }
        if (to - from + 1 > chain.maxRange) {
          const e = new Error("processing response error");
          e.code = "SERVER_ERROR";
          e.body = JSON.stringify({ error: { code: -32602, message: `query exceeds max block range ${chain.maxRange}` } });
          throw e;
        }
        return chain.logs.filter((l) => {
          const n = parseInt(l.blockNumber, 16);
          return (f.address === undefined || l.address === f.address) && n >= from && n <= to && l.topics[2] === f.topics[2];
        });
      }
      throw new Error(`unexpected ${method}`);
    },
  };
  return chain;
};

let txCounter = 0;
const transfer = (token, block, units) => ({
  address: token,
  topics: [TRANSFER, pad("0x00000000000000000000000000000000000000cc"), pad(PAY_TO)],
  data: ethers.utils.hexZeroPad(ethers.BigNumber.from(units).toHexString(), 32),
  blockNumber: hex(block),
  transactionHash: "0x" + String(++txCounter).padStart(64, "0"),
  logIndex: "0x0",
  removed: false,
});

const keyed401 = () => {
  const e = new Error(
    'bad response (status=401, headers={}, body="unauthorized", requestBody="{}", requestMethod="POST", url="https://rpc-a.example/v2/SECRETKEY123", code=SERVER_ERROR, version=web/5.7.1)',
  );
  e.code = "SERVER_ERROR";
  e.status = 401;
  e.reason = "bad response";
  return e;
};

// providers: url -> fake provider. A URL without one behaves like an unreachable RPC.
const setup = (providers) => {
  calls.dispensed.length = 0;
  calls.logged.length = 0;
  const unreachable = { send: async () => { throw Object.assign(new Error("connect ECONNREFUSED"), { code: "NETWORK_ERROR" }); } };
  _test.setProviderFactory((url) => providers[url] || unreachable);
  return _test.createWatcher(network(), PAY_TO);
};

test("only payments made after startup dispense", async () => {
  const a = fakeChain({ head: 1000 });
  a.logs.push(transfer(USDC, 990, 1_000_001));
  const w = setup({ "https://rpc-a.example/v2/SECRETKEY123": a.provider });
  await _test.tick(w);
  assert.strictEqual(w.cursor, 1000 - LAG);
  assert.strictEqual(calls.dispensed.length, 0);
  assert.strictEqual(w.health.ok, true);
});

test("a new payment dispenses the selected pin once and is logged as evm", async () => {
  const a = fakeChain({ head: 1000 });
  const w = setup({ "https://rpc-a.example/v2/SECRETKEY123": a.provider });
  await _test.tick(w);
  a.head = 1010;
  a.logs.push(transfer(USDT, 1005, 1_000_002)); // 1.000002 USDT -> selection 2 -> pin 517
  await _test.tick(w);
  assert.deepStrictEqual(calls.dispensed, [{ pin: 517, currency: "USDT" }]);
  assert.deepStrictEqual(calls.logged, [{ pin: 517, currency: "USDT", amount: 1.000002, method: "evm" }]);
  // A rescan of the same blocks must not dispense again.
  w.cursor = 1000;
  await _test.tick(w);
  assert.strictEqual(calls.dispensed.length, 1);
  assert.ok(w.health.lastPaymentAt);
});

test("one eth_getLogs per block range, for transfers to us of any token", async () => {
  const a = fakeChain({ head: 1000 });
  const w = setup({ "https://rpc-a.example/v2/SECRETKEY123": a.provider });
  await _test.tick(w);
  a.head = 1003;
  a.logs.push(transfer("0x00000000000000000000000000000000000000ff", 1001, 5_000_000)); // not our token
  await _test.tick(w);
  assert.strictEqual(w.health.ok, true);
  assert.strictEqual(a.filters.length, 1);
  assert.strictEqual(a.filters[0].address, undefined);
  assert.strictEqual(calls.dispensed.length, 0);
});

test("an RPC block-range cap shrinks the query instead of failing the poll", async () => {
  const a = fakeChain({ head: 1000, maxRange: 100 });
  const w = setup({ "https://rpc-a.example/v2/SECRETKEY123": a.provider });
  await _test.tick(w);
  a.head = 1600;
  a.logs.push(transfer(USDC, 1400, 1_000_001));
  // Several polls may be needed while the range settles under the cap.
  for (let i = 0; i < 5 && w.cursor < a.head - LAG; i++) await _test.tick(w);
  assert.strictEqual(w.cursor, 1600 - LAG);
  assert.strictEqual(w.health.consecutiveFailures, 0);
  assert.ok(w.rangeCap <= 100, `rangeCap ${w.rangeCap}`);
  assert.deepStrictEqual(calls.dispensed, [{ pin: 516, currency: "USDC" }]);
});

test("a failing RPC is reported without its key, the fallback takes over, and the gap is caught up", async () => {
  const a = fakeChain({ head: 1000 });
  const b = fakeChain({ head: 1000 });
  const w = setup({ "https://rpc-a.example/v2/SECRETKEY123": a.provider, "https://rpc-b.example": b.provider });
  await _test.tick(w);
  a.fail = keyed401();
  let delay = await _test.tick(w);
  assert.strictEqual(w.health.ok, false);
  assert.strictEqual(w.health.consecutiveFailures, 1);
  assert.ok(delay > 15000, "backs off");
  const msg = w.health.lastPollError.message;
  assert.match(msg, /HTTP 401/);
  assert.ok(!msg.includes("SECRETKEY123") && !msg.includes("rpc-a.example"), msg);
  assert.strictEqual(w.health.lastPollError.rpcHost, "rpc-a.example");
  delay = await _test.tick(w, delay);
  assert.strictEqual(w.health.consecutiveFailures, 2);
  assert.strictEqual(w.health.rpcHost, "rpc-b.example");
  assert.strictEqual(w.health.rpcSwitches, 1);
  // Paid during the outage, a minute ago: still dispensed once the fallback answers.
  b.head = 1030;
  b.logs.push(transfer(USDC, 1001, 1_000_001));
  await _test.tick(w, delay);
  assert.strictEqual(w.health.ok, true);
  assert.strictEqual(w.health.consecutiveFailures, 0);
  assert.strictEqual(w.health.lastPollError, null);
  assert.deepStrictEqual(calls.dispensed, [{ pin: 516, currency: "USDC" }]);
});

test("a payment found long after it was made is reported, not dispensed", async () => {
  const a = fakeChain({ head: 1000 });
  const w = setup({ "https://rpc-a.example/v2/SECRETKEY123": a.provider });
  await _test.tick(w);
  a.head = 1500;
  a.blockTime = (n) => Math.floor(Date.now() / 1000) - (n === 1100 ? 25 * 60 : 0);
  a.logs.push(transfer(USDC, 1100, 1_000_001));
  await _test.tick(w);
  assert.strictEqual(calls.dispensed.length, 0);
  assert.strictEqual(calls.logged.length, 0);
  assert.strictEqual(w.health.latePayments.length, 1);
  const late = w.health.latePayments[0];
  assert.strictEqual(late.symbol, "USDC");
  assert.strictEqual(late.amount, "1.000001");
  assert.ok(late.at - late.paidAt >= 25 * 60 * 1000);
});

test("a failed block lookup leaves the payment to be retried, not skipped", async () => {
  const a = fakeChain({ head: 1000 });
  const w = setup({ "https://rpc-a.example/v2/SECRETKEY123": a.provider });
  await _test.tick(w);
  a.head = 1010;
  a.logs.push(transfer(USDC, 1005, 1_000_001));
  const send = a.provider.send;
  a.provider.send = async (m, p) => {
    if (m === "eth_getBlockByNumber") throw new Error("timeout");
    return send(m, p);
  };
  await _test.tick(w);
  assert.strictEqual(w.health.ok, false);
  assert.strictEqual(w.cursor, 1000 - LAG);
  a.provider.send = send;
  await _test.tick(w);
  assert.deepStrictEqual(calls.dispensed, [{ pin: 516, currency: "USDC" }]);
});

test("blocks within HEAD_LAG_BLOCKS of the head wait for the next poll", async () => {
  const a = fakeChain({ head: 1000 });
  const w = setup({ "https://rpc-a.example/v2/SECRETKEY123": a.provider });
  await _test.tick(w);
  a.head = 1010;
  a.logs.push(transfer(USDC, 1010, 1_000_001)); // in the newest block
  await _test.tick(w);
  assert.strictEqual(calls.dispensed.length, 0);
  assert.strictEqual(w.cursor, 1010 - LAG);
  a.head = 1012;
  await _test.tick(w);
  assert.deepStrictEqual(calls.dispensed, [{ pin: 516, currency: "USDC" }]);
});

test("after an outage, catch-up goes back at most 10 minutes and the rest is reported", async () => {
  const a = fakeChain({ head: 1000 }); // blocks 2 s apart
  const w = setup({ "https://rpc-a.example/v2/SECRETKEY123": a.provider });
  await _test.tick(w);
  // Down for 30 minutes: 900 blocks went by.
  w.cursorAt = Date.now() - 30 * 60 * 1000;
  a.head = 1000 + 900;
  a.logs.push(transfer(USDC, 1100, 1_000_001)); // ~27 min ago: in the skipped part
  a.logs.push(transfer(USDT, 1880, 1_000_003)); // ~40 s ago: caught up and dispensed
  for (let i = 0; i < 5 && w.cursor < a.head - LAG; i++) await _test.tick(w);
  assert.strictEqual(w.health.ok, true);
  assert.strictEqual(w.health.skippedRanges.length, 1);
  const skip = w.health.skippedRanges[0];
  assert.strictEqual(skip.fromBlock, 1000 - LAG + 1);
  assert.strictEqual(skip.toBlock, 1898 - 300); // the newest 10 of 30 minutes are kept
  assert.match(skip.reason, /more than 10 min behind/);
  assert.ok(skip.toTime - skip.fromTime >= 19 * 60 * 1000, "about 20 minutes skipped");
  assert.deepStrictEqual(calls.dispensed, [{ pin: 518, currency: "USDT" }]);
  assert.strictEqual(w.health.latePayments.length, 0);
  assert.strictEqual(w.cursor, 1898);
});

test("an RPC that refuses older blocks (Hyperliquid's archive quota) is skipped past, not retried forever", async () => {
  const a = fakeChain({ head: 1000, archivedBelowDepth: 100 });
  const w = setup({ "https://rpc-a.example/v2/SECRETKEY123": a.provider });
  await _test.tick(w);
  a.head = 1200; // 200 blocks later, within 10 minutes, but older blocks count as archived
  a.logs.push(transfer(USDC, 1180, 1_000_001));
  await _test.tick(w);
  assert.strictEqual(w.health.ok, true);
  assert.strictEqual(w.health.skippedRanges.length, 1);
  assert.match(w.health.skippedRanges[0].reason, /archived/);
  assert.strictEqual(w.health.skippedRanges[0].toBlock, 1198 - 50);
  assert.deepStrictEqual(calls.dispensed, [{ pin: 516, currency: "USDC" }]);
  assert.strictEqual(w.cursor, 1198);
});

test("an RPC that insists on a token address (publicnode) gets one query per token instead", async () => {
  const a = fakeChain({ head: 1000, requireAddress: true });
  const w = setup({ "https://rpc-a.example/v2/SECRETKEY123": a.provider });
  await _test.tick(w);
  a.head = 1010;
  a.logs.push(transfer(USDT, 1005, 1_000_004)); // selection 4 -> pin 524
  await _test.tick(w);
  assert.strictEqual(w.health.ok, true);
  assert.strictEqual(w.health.consecutiveFailures, 0);
  assert.strictEqual(w.perToken, true);
  assert.deepStrictEqual(calls.dispensed, [{ pin: 524, currency: "USDT" }]);
});

