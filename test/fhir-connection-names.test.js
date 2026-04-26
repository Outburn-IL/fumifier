import fumifier from '../dist/index.mjs';
import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

const { expect, use } = chai;
use(chaiAsPromised);

describe('$fhirConnectionNames', function() {
  it('returns an empty array when no names are configured', async function() {
    const expr = await fumifier('$fhirConnectionNames()');

    const result = await expr.evaluate({});
    expect(result).to.deep.equal([]);
  });

  it('returns configured names in order', async function() {
    const expr = await fumifier('$fhirConnectionNames()', {
      namedFhirConnectionNames: ['serverA', 'serverB']
    });

    const result = await expr.evaluate({});
    expect(result).to.deep.equal(['serverA', 'serverB']);
  });

  it('returns a fresh array for each evaluation result', async function() {
    const expr = await fumifier('$fhirConnectionNames()', {
      namedFhirConnectionNames: ['serverA', 'serverB']
    });

    const first = await expr.evaluate({});
    first.push('mutated');

    const second = await expr.evaluate({});
    expect(second).to.deep.equal(['serverA', 'serverB']);
  });

  it('supports runtime overrides', async function() {
    const expr = await fumifier('$fhirConnectionNames()', {
      namedFhirConnectionNames: ['compiledA']
    });

    const result = await expr.evaluate({}, {}, {
      namedFhirConnectionNames: ['runtimeA', 'runtimeB']
    });

    expect(result).to.deep.equal(['runtimeA', 'runtimeB']);
  });

  it('supports provider functions', async function() {
    const expr = await fumifier('$fhirConnectionNames()', {
      namedFhirConnectionNames: () => ['serverA', 'serverB']
    });

    const result = await expr.evaluate({});
    expect(result).to.deep.equal(['serverA', 'serverB']);
  });

  it('rejects unexpected arguments through signature validation', async function() {
    const expr = await fumifier("$fhirConnectionNames('serverA')");

    await expect(expr.evaluate({})).to.be.rejected;
  });
});