import { expect } from 'chai';
import fumifier from '../src/fumifier.js';

describe('Function Error Spans', () => {
  it('should anchor contextual signature errors to the call head span', async () => {
    const compiled = await fumifier('$foo($, params)');
    compiled.registerFunction('foo', function(resourceType, params, options) {
      return { resourceType, params, options };
    }, '<s-o?o?:x>');

    const report = await compiled.evaluateVerbose({ id: 'example' });
    const diagnostic = report.diagnostics.error[0];

    expect(report.ok).to.equal(false);
    expect(report.diagnostics.error).to.have.length(1);
    expect(diagnostic).to.include({
      code: 'T0411',
      token: 'foo',
      index: 1,
      line: 1,
      start: 0,
      position: 5
    });
  });

  it('should anchor direct argument validation errors to the call head span', async () => {
    const compiled = await fumifier('$foo($, params)');
    compiled.registerFunction('foo', function(resourceType, params) {
      return { resourceType, params };
    }, '<so?:x>');

    const report = await compiled.evaluateVerbose({ id: 'example' });
    const diagnostic = report.diagnostics.error[0];

    expect(report.ok).to.equal(false);
    expect(report.diagnostics.error).to.have.length(1);
    expect(diagnostic).to.include({
      code: 'T0410',
      token: 'foo',
      index: 1,
      line: 1,
      start: 0,
      position: 5
    });
  });
});