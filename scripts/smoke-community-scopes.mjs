import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync, renameSync, rmdirSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.argv[2] === '--worker') {
  const { FumeEngine } = await import('../../fume-community/dist/index.mjs');
  const { defineFunction } = await import('../dist/index.mjs');
  const engine = await FumeEngine.create({
    config: {
      FHIR_SERVER_BASE: 'n/a', MAPPINGS_FOLDER: 'n/a',
      FHIR_PACKAGE_CACHE_DIR: fileURLToPath(new URL('../../fume-community/tests/.fhir-packages', import.meta.url))
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} }
  });
  const host = defineFunction(function() {
    return this.evaluateMapping({
      expression: '[$value, $exists($private), $executionId]',
      scope: {
        bindings: { value: 'scoped' },
        mappingCache: { async getKeys() { return []; }, async get() { return undefined; } }
      }
    });
  }, '<:x>');
  const report = await engine.transformVerbose({}, '$host()', { host, private: 'deployment' });
  assert.equal(report.ok, true);
  assert.deepEqual(report.result, ['scoped', false, report.executionId]);
  console.log(JSON.stringify({ node: process.version, ok: report.ok, scopeIsolation: true, sharedIdentity: true }));
} else {
  const installed = fileURLToPath(new URL('../../fume-community/node_modules/fumifier', import.meta.url));
  const backup = installed + '.session1-smoke-backup';
  const local = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
  assert.equal(JSON.parse(readFileSync(installed + '/package.json', 'utf8')).version, '2.4.0');
  assert.notEqual(realpathSync(installed), local);
  assert.equal(existsSync(backup), false, 'Refusing to overwrite an existing backup');
  renameSync(installed, backup);
  let linked = false;
  try {
    symlinkSync(local, installed, 'junction');
    linked = true;
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker'], {
      stdio: 'inherit', timeout: 90000
    });
    assert.equal(result.status, 0, result.error?.message || 'Community smoke failed');
  } finally {
    if (linked) {
      assert.equal(realpathSync(installed), local);
      rmdirSync(installed);
    }
    renameSync(backup, installed);
    console.log('Restored published Community fumifier directory.');
  }
}