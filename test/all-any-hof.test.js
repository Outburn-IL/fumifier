import fumifier from '../dist/index.mjs';
import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

const { expect, use } = chai;
use(chaiAsPromised);

describe('$all and $any HOFs', function() {
  it('normalizes undefined input to deterministic empty-collection booleans', async function() {
    const expr = await fumifier('[ $all(nothing, function($v){$v}), $any(nothing, function($v){$v}) ]');
    const res = await expr.evaluate({});

    expect(res).to.deep.equal([true, false]);
  });

  it('supports singleton input, chaining, and callback arguments', async function() {
    const expr = await fumifier('[5 ~> $all(function($v,$i,$a){$v = 5 and $i = 0 and $a[0] = 5}), [1,2,3] ~> $any(function($v){$v = 2})]');
    const res = await expr.evaluate({});

    expect(res).to.deep.equal([true, true]);
  });

  it('$any short-circuits async predicates in collection order', async function() {
    const calls = [];
    const expr = await fumifier('$any([1,2,3,4], $predicate)');
    expr.assign('predicate', async (value) => {
      calls.push(value);
      await new Promise(resolve => setTimeout(resolve, 5));
      return value === 2;
    });

    const res = await expr.evaluate({});

    expect(res).to.equal(true);
    expect(calls).to.deep.equal([1, 2]);
  });

  it('$all short-circuits async predicates on the first falsy result', async function() {
    const calls = [];
    const expr = await fumifier('$all([2,4,5,8], $predicate)');
    expr.assign('predicate', async (value) => {
      calls.push(value);
      await new Promise(resolve => setTimeout(resolve, 5));
      return value % 2 === 0;
    });

    const res = await expr.evaluate({});

    expect(res).to.equal(false);
    expect(calls).to.deep.equal([2, 4, 5]);
  });
});