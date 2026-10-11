import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const workloads = [
  { name: 'lambda-fib-20', expression: '($f := function($n) { $n <= 1 ? $n : $f($n-1) + $f($n-2) }; $f(20))' },
  { name: 'sum-200000', expression: '$sum([1..200000].($*2))' },
  { name: 'objects-30000', expression: '[1..30000].({"value": $, "double": $*2})' }
];
const warmups = 5;
const samples = 7;
const median = values => [...values].sort((first, second) => first - second)[Math.floor(values.length / 2)];

if (process.argv[2] === '--worker') {
  const { default: fumifier } = await import(process.argv[3]);
  const results = [];
  for (const workload of workloads) {
    const compiled = await fumifier(workload.expression);
    for (let iteration = 0; iteration < warmups; iteration++) await compiled.evaluate({});
    const durations = [];
    let result;
    for (let iteration = 0; iteration < samples; iteration++) {
      const start = performance.now();
      result = await compiled.evaluate({});
      durations.push(performance.now() - start);
    }
    results.push({ name: workload.name, medianMs: median(durations), durations,
      fingerprint: createHash('sha256').update(JSON.stringify(result)).digest('hex') });
  }
  console.log(JSON.stringify(results));
} else {
  const baseline = new URL('../../fume-community/node_modules/fumifier/dist/index.mjs', import.meta.url);
  const local = new URL('../dist/index.mjs', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('../package.json', baseline), 'utf8'));
  assert.equal(manifest.version, '2.4.0', 'Baseline must be published fumifier@2.4.0');
  assert.notEqual(realpathSync(fileURLToPath(baseline)), realpathSync(fileURLToPath(local)), 'Baseline must not be linked to the local build');
  const rows = [];
  for (const order of [['published', 'local'], ['local', 'published']]) {
    const results = {};
    for (const version of order) {
      const worker = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker',
        (version === 'published' ? baseline : local).href], { encoding: 'utf8', timeout: 120000 });
      assert.equal(worker.status, 0, worker.error?.message || worker.stderr);
      results[version] = JSON.parse(worker.stdout);
    }
    for (let index = 0; index < workloads.length; index++) {
      const publishedResult = results.published[index];
      const localResult = results.local[index];
      assert.equal(localResult.fingerprint, publishedResult.fingerprint, workloads[index].name);
      const overheadPercent = (localResult.medianMs / publishedResult.medianMs - 1) * 100;
      rows.push({ order: order.join(' -> '), workload: workloads[index].name,
        publishedMs: publishedResult.medianMs, localMs: localResult.medianMs, overheadPercent });
      if (overheadPercent > 3) process.exitCode = 1;
    }
  }
  console.log(JSON.stringify({ node: process.version, baseline: manifest.version, warmups, samples,
    input: {}, iterationsPerSample: 1, workloads, rows, withinBudget: !process.exitCode }, null, 2));
}