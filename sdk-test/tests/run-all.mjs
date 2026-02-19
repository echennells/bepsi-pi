/**
 * Run all tests sequentially.
 * Tests 03 and 07 listen for events so they're time-bounded.
 */
import { execFileSync } from 'node:child_process';
import { logSection } from './helpers.mjs';

const tests = [
  { script: 'tests/01-init-wallet.mjs', name: 'Wallet Init' },
  { script: 'tests/02-balance-api.mjs', name: 'Balance API' },
  { script: 'tests/03-events.mjs', name: 'Events (2min listen)' },
  { script: 'tests/04-token-decimals.mjs', name: 'Token Decimals' },
  { script: 'tests/05-invoices.mjs', name: 'Invoice APIs' },
  { script: 'tests/06-query-tokens.mjs', name: 'Token Tx Queries' },
  { script: 'tests/07-detection.mjs', name: 'Full Detection (2min listen)' },
];

const results = [];

for (const test of tests) {
  logSection(`Running: ${test.name}`);
  const startTime = Date.now();

  try {
    execFileSync('node', [test.script], {
      stdio: 'inherit',
      timeout: 3 * 60 * 1000, // 3 min per test max
    });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    results.push({ name: test.name, status: 'PASS', elapsed });
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    results.push({ name: test.name, status: 'FAIL', elapsed, error: err.message?.slice(0, 100) });
  }
}

logSection('Test Results');
for (const r of results) {
  const icon = r.status === 'PASS' ? 'OK' : 'FAIL';
  console.log(`  [${icon}] ${r.name} (${r.elapsed}s)${r.error ? ` — ${r.error}` : ''}`);
}

const failed = results.filter(r => r.status === 'FAIL');
if (failed.length > 0) {
  console.log(`\n  ${failed.length}/${results.length} tests failed.`);
  process.exit(1);
} else {
  console.log(`\n  All ${results.length} tests passed.`);
}
