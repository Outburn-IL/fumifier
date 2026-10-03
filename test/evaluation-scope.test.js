import assert from 'node:assert/strict';
import fumifier, { FumifierError, defineFunction, parseSignatureStructure, getBuiltinBindingNames, getReservedBindingNames } from '../src/fumifier.js';
import compileArgumentValidator from '../src/utils/signature.js';
import { push, decide } from '../src/utils/diagnostics.js';

const emptyCache = { async getKeys() { return []; }, async get() { return undefined; } };
const scope = bindings => ({ bindings, mappingCache: emptyCache });

describe('Explicit evaluation scopes', function() {
  it('exports the same utilities from packaged Node entries without adding browser evaluation', async function() {
    const esm = await import('../dist/index.mjs');
    const cjsModule = await import('../dist/index.cjs');
    const cjs = cjsModule.default.default || cjsModule.default;
    assert.equal(typeof esm.defineFunction, 'function');
    assert.equal(typeof cjs.defineFunction, 'function');
    assert.deepEqual(cjs.getBuiltinBindingNames(), esm.getBuiltinBindingNames());
    assert.deepEqual(cjs.getReservedBindingNames(), esm.getReservedBindingNames());
    assert.deepEqual(cjs.parseSignatureStructure('<s:s>'), esm.parseSignatureStructure('<s:s>'));
    const browser = await import('../dist/browser.mjs');
    assert.equal(browser.defineFunction, undefined);
  });
  it('structurally inspects arguments, nested function types and return types', function() {
    const result = parseSignatureStructure('<s-a<(sn)>?n+:f<s:n>>');
    assert.equal(result.arguments[0].contextDefault, true);
    assert.equal(result.arguments[1].optional, true);
    assert.equal(result.arguments[1].subtype.choice[1].type, 'n');
    assert.equal(result.arguments[2].repeated, true);
    assert.equal(result.returnType.type, 'f');
    assert.equal(result.hasFunctionType, true);
    assert.equal(parseSignatureStructure('<x?o?:x>').hasFunctionType, false);
    for (const invalid of ['s:s', '<s:s', '<s:>', '<s:z>', '<s:ss>', '<s:s>tail', '<a<s:s>:x>', '<n<s>:n>', '<?s:x>', '<s??:x>', '<(sf:x>']) {
      assert.throws(() => parseSignatureStructure(invalid), error => error instanceof FumifierError && ['S0201', 'S0202', 'S0401', 'S0402'].includes(error.code));
    }
    const names = getBuiltinBindingNames();
    for (const name of ['search', 'eval', 'map', 'warn', 'useFhirServer', 'now', 'throwLevel', 'logLevel', 'collectLevel', 'validationLevel']) assert.ok(names.includes(name));
    names.length = 0;
    assert.ok(getBuiltinBindingNames().length > 0);
    assert.deepEqual(getReservedBindingNames(), ['executionId', 'fumeHttpInvocation']);
    getReservedBindingNames().length = 0;
    assert.equal(getReservedBindingNames().length, 2);
  });
  it('isolates a scoped callee while ordinary mappings inherit caller overrides', async function() {
    const mappingCache = {
      async getKeys() { return ['isolated', 'ordinary']; },
      async get() { return '{"private": $private, "search": $search("Patient")}'; },
      getDefinition(name) {
        if (name === 'isolated') return { expression: '{"private": $private, "search": $search("Patient")}', scope: scope({}) };
      }
    };
    const compiled = await fumifier('[$isolated(), $ordinary()]', {
      mappingCache,
      fhirClient: { search: async () => 'service' }
    });
    const result = await compiled.evaluate({}, { private: 'caller', search: () => 'override' });
    assert.deepEqual(result, [{ search: 'service' }, { private: 'caller', search: 'override' }]);
  });

  it('uses an explicit empty scope rather than assigned or compilation mappings', async function() {
    const compiled = await fumifier('$exists($private) or $exists($hidden)', {
      mappingCache: { ...emptyCache, async getKeys() { return ['hidden']; }, async get() { return '1'; } }
    });
    compiled.assign('private', true);
    assert.equal(await compiled.evaluate({}, {}, { evaluationScope: scope({}) }), false);
    assert.equal(await compiled.evaluate({}), true);
  });

  it('exposes the scoped mapping executor to wrapped native functions', async function() {
    const compiled = await fumifier('$host()');
    compiled.registerFunction('host', async function() {
      return this.evaluateMapping({ expression: '{"input": $, "root": $$, "id": $executionId, "private": $private}', scope: scope({}) }, null);
    });
    const result = await compiled.evaluate({ original: true }, { private: true });
    assert.equal(result.input, null);
    assert.equal(result.root, null);
    assert.equal(typeof result.id, 'string');
    assert.equal(result.private, undefined);
  });

  it('cancels before dispatch and discards an awaited native result', async function() {
    const controller = new AbortController();
    const compiled = await fumifier('$host()');
    let calls = 0;
    compiled.registerFunction('host', async () => { calls++; controller.abort(); return 1; });
    await assert.rejects(compiled.evaluate({}, {}, { signal: controller.signal }), error => error instanceof FumifierError && error.code === 'D3150');
    assert.equal(calls, 1);
    await assert.rejects(compiled.evaluate({}, {}, { signal: controller.signal }), error => error.code === 'D3150');
    assert.equal(calls, 1);
  });

  it('transitions between scopes and keeps eval and direct-binding precedence scoped', async function() {
    const isolated = scope({ value: 'isolated' });
    const opted = scope({ value: 'global', private: 'deployment' });
    opted.mappingCache = {
      async getKeys() { return ['isolated']; }, async get() { throw new Error('definition only'); },
      getDefinition() { return { expression: '$value & ":" & $exists($private)', scope: isolated }; }
    };
    const compiled = await fumifier('[$value, $isolated(), $eval("$value"), $exists($caller)]');
    assert.deepEqual(await compiled.evaluate({}, { caller: true }, { evaluationScope: opted }), ['global', 'isolated:false', 'global', true]);
    const override = await fumifier('$isolated');
    assert.equal(await override.evaluate({}, { isolated: 'call' }, { evaluationScope: opted }), 'call');
    assert.equal(await override.evaluate({}, {}, { evaluationScope: { ...opted, bindings: { isolated: 'scope' } } }), 'scope');
  });

  it('captures definitions once and does not cache same-source scopes in ASTs', async function() {
    let captures = 0;
    const mappingCache = {
      async getKeys() { return ['first', 'second']; }, async get() { throw new Error('unexpected fallback'); },
      getDefinition(name) { captures++; return { expression: '$value', scope: scope({ value: name }) }; }
    };
    const compiled = await fumifier('[$first(), $first(), $second()]', { mappingCache });
    assert.deepEqual(await compiled.evaluate({}), ['first', 'first', 'second']);
    assert.equal(captures, 2);
    const direct = await fumifier('$eval("$value")');
    assert.deepEqual(await Promise.all(['one', 'two', 'three'].map(value => direct.evaluate({}, {}, { evaluationScope: scope({ value }) }))), ['one', 'two', 'three']);
  });

  it('preserves identity, timestamp, HTTP metadata and scoped threshold defaults', async function() {
    const compiled = await fumifier('$host()');
    compiled.registerFunction('host', async function() {
      const result = await this.evaluateMapping({ expression: '{"id": $executionId, "timestamp": $millis(), "http": $fumeHttpInvocation, "threshold": $throwLevel}', scope: scope({ throwLevel: 10 }) }, undefined, { executionId: 'forged', fumeHttpInvocation: 'forged', throwLevel: 20 });
      assert.equal(result.id, this.executionId);
      assert.equal(result.timestamp, this.environment.timestamp.getTime());
      return result;
    });
    const result = await compiled.evaluate({}, { fumeHttpInvocation: { mappingId: 'public' }, throwLevel: 99 });
    assert.equal(result.threshold, 20);
    assert.deepEqual(result.http, { mappingId: 'public' });
    const direct = await fumifier('$fumeHttpInvocation');
    assert.deepEqual(await direct.evaluate({}, { fumeHttpInvocation: { mappingId: 'http' } }, { evaluationScope: scope({}) }), { mappingId: 'http' });
  });

  it('shares callback diagnostics and honors signatures without checking annotated results', async function() {
    const compiled = await fumifier('$host()');
    compiled.registerFunction('host', async function() {
      const definition = { expression: '($warn("callback"); "not-a-number")', signature: '<s?o?:n>', scope: scope({}) };
      await assert.rejects(this.evaluateMapping(definition, 42), error => error.code === 'T0410');
      assert.equal(await this.evaluateMapping({ expression: '$', signature: '<s:s>', scope: scope({}) }, 'only-input'), 'only-input');
      assert.equal(await this.evaluateMapping({ expression: '$', signature: '<s-:s>', scope: scope({}) }), 'focus');
      return this.evaluateMapping(definition, 'input');
    });
    const report = await compiled.evaluateVerbose('focus', {}, { logger: { debug() {}, info() {}, warn() {}, error() {} } });
    assert.equal(report.result, 'not-a-number');
    assert.equal(report.diagnostics.warning.length, 1);
    assert.equal(report.diagnostics.warning[0].executionId, report.executionId);
  });

  it('keeps parallel callback connection choices out of siblings and the caller', async function() {
    const compiled = await fumifier('($useFhirServer("caller"); [$host(), $search("Patient").total])', {
      fhirClient: { search: async () => ({ total: 0 }) },
      connectionResolver: target => ({ search: async () => ({ total: target === 'first' ? 1 : target === 'second' ? 2 : 3 }) })
    });
    compiled.registerFunction('host', async function() {
      const definition = { expression: '($useFhirServer($target); $search("Patient").total)', scope: scope({}) };
      return Promise.all(['first', 'second'].map(target => this.evaluateMapping(definition, {}, { target })));
    });
    assert.deepEqual(await compiled.evaluate({}), [1, 2, 3]);
  });

  it('revokes only a cancelled callback and prevents its late diagnostic writes', async function() {
    const compiled = await fumifier('$host()');
    const controller = new AbortController();
    let release;
    let started;
    const blocked = new Promise(resolve => { release = resolve; });
    const dispatched = new Promise(resolve => { started = resolve; });
    const definition = { expression: '$wait()', scope: scope({ wait: defineFunction(async function() {
      started();
      await blocked;
      push(this.environment, { code: 'F5320', message: 'late callback' });
      assert.equal(decide('F5320', this.environment).shouldLog, false);
      return 1;
    }) }) };
    compiled.registerFunction('host', async function() {
      const pending = this.evaluateMapping(definition, {}, {}, { signal: controller.signal });
      await dispatched;
      controller.abort();
      release();
      await assert.rejects(pending, error => error.code === 'D3150');
      return this.evaluateMapping({ expression: '($warn("sibling"); 2)', scope: scope({}) });
    });
    const report = await compiled.evaluateVerbose({}, {}, { logger: { debug() {}, info() {}, warn() {}, error() {} } });
    assert.equal(report.result, 2);
    assert.equal(report.diagnostics.warning.length, 1);
  });

  it('closes a captured executor and its diagnostic sink after evaluation settles', async function() {
    const compiled = await fumifier('$host()');
    let captured;
    compiled.registerFunction('host', function() { captured = this; return 1; });
    const report = await compiled.evaluateVerbose({});
    await assert.rejects(captured.evaluateMapping({ expression: '1', scope: scope({}) }), error => error.code === 'D3150');
    push(captured.environment, { code: 'F5320', message: 'late' });
    assert.equal(decide('F5320', captured.environment).shouldLog, false);
    assert.equal(report.diagnostics.warning.length, 0);
  });

  it('reports cancellation in verbose mode rather than committing a result', async function() {
    const controller = new AbortController();
    const compiled = await fumifier('$host()');
    compiled.registerFunction('host', () => { controller.abort(); return 1; });
    const report = await compiled.evaluateVerbose({}, {}, { signal: controller.signal });
    assert.equal(report.result, undefined);
    assert.equal(report.ok, false);
    assert.equal(report.status, 422);
    assert.equal(report.diagnostics.error[0].code, 'D3150');
    const scopedReport = await compiled.evaluateVerbose({}, {}, { signal: controller.signal, evaluationScope: scope({}) });
    assert.equal(scopedReport.ok, false);
    assert.equal(scopedReport.status, 422);
    assert.equal(scopedReport.diagnostics.error[0].code, 'D3150');
  });

  it('combines a callback signal with the original signal without replacing it', async function() {
    const parent = new AbortController();
    const child = new AbortController();
    const compiled = await fumifier('$host()');
    compiled.registerFunction('host', async function() {
      const definition = { expression: '$wait()', scope: scope({ wait: async () => { parent.abort(); return 1; } }) };
      await assert.rejects(this.evaluateMapping(definition, {}, {}, { signal: child.signal }), error => error.code === 'D3150');
      return 2;
    });
    await assert.rejects(compiled.evaluate({}, {}, { signal: parent.signal }), error => error.code === 'D3150');
    assert.equal(child.signal.aborted, false);
  });

  it('keeps per-call FHIR overrides ahead of mappings and runtime service installation', async function() {
    const compiled = await fumifier('$search("Patient")');
    assert.equal(await compiled.evaluate({}, { search: () => 'call' }, {
      evaluationScope: scope({ search: () => 'scope' }), fhirClient: { search: async () => 'service' }
    }), 'call');
  });

  it('keeps ordinary identity rebinding while scoped calls and callbacks protect it', async function() {
    const selectedScope = scope({});
    const cache = {
      ...emptyCache, async getKeys() { return ['ordinary', 'scoped']; },
      async get() { return '[$executionId, $fumeHttpInvocation]'; },
      getDefinition(name) { if (name === 'scoped') return { expression: '[$executionId, $fumeHttpInvocation]', scope: selectedScope }; }
    };
    const compiled = await fumifier('[$ordinary($, {"executionId":"override","fumeHttpInvocation":"override"}), $scoped($, {"executionId":"override","fumeHttpInvocation":"override"})]', { mappingCache: cache });
    const report = await compiled.evaluateVerbose({}, { fumeHttpInvocation: 'original' });
    assert.deepEqual(report.result, ['override', 'override', report.executionId, 'original']);
    const host = await fumifier('$host()');
    host.registerFunction('host', function() {
      return this.evaluateMapping({ expression: '[$executionId, $fumeHttpInvocation]' }, {}, { executionId: 'override', fumeHttpInvocation: 'override' });
    });
    const callback = await host.evaluateVerbose({}, { fumeHttpInvocation: 'original' });
    assert.deepEqual(callback.result, [callback.executionId, 'original']);
  });

  it('captures a scope lazily once per evaluation and snapshots bindings only once', async function() {
    let keys = 0;
    let definitions = 0;
    const selectedScope = scope({ value: 'first' });
    selectedScope.mappingCache = {
      ...emptyCache, async getKeys() { keys++; return ['echo']; },
      getDefinition() { definitions++; return { expression: '$value', scope: selectedScope }; }
    };
    const compiled = await fumifier('$host()');
    compiled.registerFunction('host', async function() {
      assert.equal(keys, definitions);
      const definition = { expression: '$echo()', scope: selectedScope };
      const first = await this.evaluateMapping(definition);
      selectedScope.bindings.value = 'next';
      const second = await this.evaluateMapping(definition);
      return [first, second];
    });
    assert.deepEqual(await compiled.evaluate({}), ['first', 'first']);
    assert.equal(keys, 1);
    assert.equal(definitions, 1);
    assert.deepEqual(await compiled.evaluate({}), ['next', 'next']);
    assert.equal(keys, 2);
  });

  it('fails closed for definition-cache errors and retains shared native executor methods', async function() {
    const compiled = await fumifier('$host()');
    const methods = [];
    compiled.registerFunction('host', function() { methods.push(this.evaluateMapping); return 1; });
    await compiled.evaluate({});
    await compiled.evaluate({});
    assert.equal(methods[0], methods[1]);
    const failing = { ...emptyCache, getDefinition() {}, async getKeys() { throw new Error('keys unavailable'); } };
    await assert.rejects(compiled.evaluate({}, {}, { evaluationScope: { bindings: {}, mappingCache: failing } }), /keys unavailable/);
    const brokenDefinition = { ...emptyCache, async getKeys() { return ['broken']; }, getDefinition() { throw new Error('definition unavailable'); } };
    await assert.rejects(compiled.evaluate({}, {}, { evaluationScope: { bindings: {}, mappingCache: brokenDefinition } }), /definition unavailable/);
  });

  it('carries debug hooks into clean scopes and excludes Object.prototype names', async function() {
    const entries = [];
    const exits = [];
    let pushes = 0;
    const compiled = await fumifier('$host()');
    compiled.assign(Symbol.for('fumifier.__evaluate_entry'), expr => { entries.push(expr.value); });
    compiled.assign(Symbol.for('fumifier.__evaluate_exit'), expr => { exits.push(expr.value); });
    compiled.assign(Symbol.for('fumifier.__createFrame_push'), () => { pushes++; });
    compiled.registerFunction('host', function() { return this.evaluateMapping({ expression: '(42)', scope: scope({}) }); });
    assert.equal(await compiled.evaluate({}), 42);
    assert.ok(entries.includes(42));
    assert.ok(exits.includes(42));
    assert.ok(pushes > 1);
    const prototype = await fumifier('$exists($constructor) or $exists($toString)');
    assert.equal(await prototype.evaluate({}), false);
  });

  it('checks every built-in signature against inspection and the legacy parser', async function() {
    const compiled = await fumifier('$inspectBuiltins()');
    compiled.registerFunction('inspectBuiltins', function() {
      for (const name of getBuiltinBindingNames()) {
        const signature = this.environment.lookup(name)?.signature?.definition;
        if (signature) {
          assert.doesNotThrow(() => compileArgumentValidator(signature), name);
          assert.doesNotThrow(() => parseSignatureStructure(signature), name);
        }
      }
      return true;
    });
    assert.equal(await compiled.evaluate({}), true);
    for (const signature of ['<(a<s>n):x>', '<(f<s:n>s):x>', '<:a<(f<s:n>n)>>']) {
      assert.throws(() => parseSignatureStructure(signature), error => error instanceof FumifierError && error.code === 'S0402');
    }
  });

  it('refreshes inherited debug hooks when they change during frame creation', async function() {
    const entries = [];
    const compiled = await fumifier('(42)');
    compiled.assign(Symbol.for('fumifier.__createFrame_push'), parent => {
      if (parent.evaluationState) {
        parent.bind(Symbol.for('fumifier.__evaluate_entry'), expr => { entries.push(expr.value); });
      }
    });
    assert.equal(await compiled.evaluate({}), 42);
    assert.ok(entries.includes(42));
  });

  it('distinguishes compiling runtime argument checks from parsing declaration structure', function() {
    const validator = compileArgumentValidator('<s:f>');
    assert.equal(validator.definition, '<s:f>');
    assert.deepEqual(validator.validate(['text'], {}), ['text']);
    assert.throws(() => validator.validate([42], {}), error => error.code === 'T0410');
    const structure = parseSignatureStructure('<s:f>');
    assert.equal(structure.arguments[0].type, 's');
    assert.equal(structure.returnType.type, 'f');
    assert.equal(structure.hasFunctionType, true);
  });
});