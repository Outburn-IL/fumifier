/*
Copyright (c) 2025 Outburn Ltd.
Project: Fumifier (part of the FUME open-source initiative)

License: See the LICENSE file included with this package for the terms that apply to this distribution.
*/

import fumifier from '../dist/index.mjs';
import chai from 'chai';

var expect = chai.expect;

describe('ExecutionId Feature', () => {
  it('should expose $executionId in user expressions', async () => {
    const compiled = await fumifier('$executionId');
    const result = await compiled.evaluate({});

    expect(result).not.to.be.undefined;
    expect(typeof result).to.equal('string');
    expect(result).to.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('should generate unique executionId for each evaluation call', async () => {
    const compiled = await fumifier('$executionId');

    const result1 = await compiled.evaluate({});
    const result2 = await compiled.evaluate({});
    const result3 = await compiled.evaluate({});

    expect(result1).not.to.be.undefined;
    expect(result2).not.to.be.undefined;
    expect(result3).not.to.be.undefined;
    expect(result1).not.to.equal(result2);
    expect(result2).not.to.equal(result3);
    expect(result1).not.to.equal(result3);
  });

  it('should include executionId in $warn diagnostic entries', async () => {
    const compiled = await fumifier('$warn("test warning")');
    const result = await compiled.evaluateVerbose({});

    expect(result.diagnostics.warning).not.to.be.undefined;
    expect(result.diagnostics.warning.length).to.equal(1);
    expect(result.diagnostics.warning[0].executionId).not.to.be.undefined;
    expect(result.diagnostics.warning[0].executionId).to.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('should include executionId in $info diagnostic entries', async () => {
    const compiled = await fumifier('$info("test info")');
    const result = await compiled.evaluateVerbose({});

    expect(result.diagnostics.debug).not.to.be.undefined;
    expect(result.diagnostics.debug.length).to.equal(1);
    expect(result.diagnostics.debug[0].executionId).not.to.be.undefined;
    expect(result.diagnostics.debug[0].executionId).to.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('should include executionId in $trace diagnostic entries', async () => {
    const compiled = await fumifier('$trace("test value", "test_label")');
    const result = await compiled.evaluateVerbose({});

    expect(result.diagnostics.debug).not.to.be.undefined;
    expect(result.diagnostics.debug.length).to.equal(1);
    expect(result.diagnostics.debug[0].executionId).not.to.be.undefined;
    expect(result.diagnostics.debug[0].executionId).to.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(result.result).to.equal("test value");
  });

  it('should include executionId in error objects', async () => {
    const compiled = await fumifier('1 / "abc"'); // This should trigger a type error

    try {
      await compiled.evaluate({});
      expect.fail('Expected an error to be thrown');
    } catch (error) {
      expect(error.executionId).not.to.be.undefined;
      expect(error.executionId).to.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    }
  });

  it('should maintain same executionId throughout single evaluation', async () => {
    const compiled = await fumifier('{"id": $executionId, "warn": $warn("test"), "trace": $trace($executionId, "exec_id")}');
    const result = await compiled.evaluateVerbose({});

    // Get the executionId from the result
    const execId = result.result.id;
    expect(execId).not.to.be.undefined;

    // Check that diagnostic entries have the same executionId
    const allDiagnostics = [
      ...(result.diagnostics.warning || []),
      ...(result.diagnostics.debug || [])
    ];

    allDiagnostics.forEach(entry => {
      expect(entry.executionId).to.equal(execId);
    });
  });

  it('should work with evaluateVerbose', async () => {
    const compiled = await fumifier('$executionId');
    const result = await compiled.evaluateVerbose({});

    expect(result.result).not.to.be.undefined;
    expect(typeof result.result).to.equal('string');
    expect(result.result).to.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    // The return object should also include executionId at the top level
    expect(result.executionId).not.to.be.undefined;
    expect(result.executionId).to.equal(result.result);
  });

  it('should generate different executionIds for evaluate vs evaluateVerbose calls', async () => {
    const compiled = await fumifier('$executionId');

    const result1 = await compiled.evaluate({});
    const result2 = await compiled.evaluateVerbose({});

    expect(result1).not.to.equal(result2.result);
  });
});