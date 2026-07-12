import { expect } from 'chai';
import fumifier from '../src/fumifier.js';

function getProcedureName(node) {
  if (!node || node.type !== 'function' || !node.procedure) {
    return null;
  }

  if (node.procedure.type === 'variable') {
    return node.procedure.value;
  }

  if (node.procedure.type === 'path' && Array.isArray(node.procedure.steps) && node.procedure.steps.length > 0) {
    return node.procedure.steps[0].value;
  }

  return null;
}

function collectFunctionLines(value, linesByName = {}) {
  if (!value || typeof value !== 'object') {
    return linesByName;
  }

  if (Array.isArray(value)) {
    value.forEach(item => collectFunctionLines(item, linesByName));
    return linesByName;
  }

  const procedureName = getProcedureName(value);
  if (procedureName) {
    if (!linesByName[procedureName]) {
      linesByName[procedureName] = [];
    }
    linesByName[procedureName].push(value.line);
  }

  Object.values(value).forEach(candidate => collectFunctionLines(candidate, linesByName));
  return linesByName;
}

function expectDiagnosticMetadata(entry, executionId, line) {
  expect(entry.executionId).to.equal(executionId);
  expect(entry.position).to.be.a('number');
  expect(entry.start).to.be.a('number');
  expect(entry.line).to.equal(line);
}

function expectDiagnosticMetadataPresence(entry, executionId) {
  expect(entry.executionId).to.equal(executionId);
  expect(entry.position).to.be.a('number');
  expect(entry.start).to.be.a('number');
  expect(entry.line).to.be.a('number');
}

describe('Diagnostic Helper Metadata', () => {
  it('should include executionId and source metadata for direct helper diagnostics', async () => {
    const compiled = await fumifier(`(
  $info("info message");
  $trace({"kind":"trace"}, "trace_label");
  $warn("warn message")
)`);

    const report = await compiled.evaluateVerbose({});
    const linesByName = collectFunctionLines(compiled.ast());

    expect(report.executionId).to.be.a('string');
    expect(report.diagnostics.warning).to.have.length(1);
    expect(report.diagnostics.debug).to.have.length(2);

    const warningEntry = report.diagnostics.warning[0];
    const infoEntry = report.diagnostics.debug.find(entry => entry.code === 'F5500');
    const traceEntry = report.diagnostics.debug.find(entry => entry.code === 'F5600');

    expect(infoEntry).to.not.equal(undefined);
    expect(traceEntry).to.not.equal(undefined);

    expectDiagnosticMetadata(infoEntry, report.executionId, linesByName.info[0]);
    expectDiagnosticMetadata(traceEntry, report.executionId, linesByName.trace[0]);
    expectDiagnosticMetadata(warningEntry, report.executionId, linesByName.warn[0]);

    expect(infoEntry.message).to.equal('info message');
    expect(traceEntry.message).to.equal('trace_label: {"kind":"trace"}');
    expect(traceEntry.label).to.equal('trace_label');
    expect(traceEntry.value).to.deep.equal({ kind: 'trace' });
    expect(warningEntry.message).to.equal('warn message');
    expect(report.result).to.equal(undefined);
  });

  it('should preserve executionId metadata for helpers invoked in nested frames', async () => {
    const compiled = await fumifier(`(
  $emitWarning := function($message) {
    $warn($message)
  };
  $emitInfo := function($message) {
    $info($message)
  };
  [
    $emitWarning("nested warning"),
    $emitInfo("nested info")
  ]
)`);

    const report = await compiled.evaluateVerbose({});
    expect(report.executionId).to.be.a('string');
    expect(report.diagnostics.warning).to.have.length(1);
    expect(report.diagnostics.debug).to.have.length(1);

    const nestedWarning = report.diagnostics.warning[0];
    const nestedInfo = report.diagnostics.debug[0];

    expectDiagnosticMetadataPresence(nestedWarning, report.executionId);
    expectDiagnosticMetadataPresence(nestedInfo, report.executionId);
    expect(nestedWarning.message).to.equal('nested warning');
    expect(nestedInfo.message).to.equal('nested info');
  });
});