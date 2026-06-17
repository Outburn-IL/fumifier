import fumifier from '../dist/index.mjs';
import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

const { expect, use } = chai;
use(chaiAsPromised);

describe('$first HOF', function() {
  it('returns undefined on undefined input', async function() {
    const expr = await fumifier('$first(nothing, $boolean)');
    const res = await expr.evaluate({});
    expect(res).to.equal(undefined);
  });

  it('treats single value as single-element array', async function() {
    const expr = await fumifier('$first(5, function($v){$v = 5})');
    const res = await expr.evaluate({});
    expect(res).to.equal(5);
  });

  it('returns first matching element using lambda', async function() {
    const expr = await fumifier('[1,2,3,4] ~> $first(function($v){$v > 2})');
    const res = await expr.evaluate({});
    expect(res).to.equal(3);
  });

  it('passes index and array correctly', async function() {
    const expr = await fumifier('[10,20,30] ~> $first(function($v,$i,$a){$v = $a[$i] and $i = 2})');
    const res = await expr.evaluate({});
    expect(res).to.equal(30);
  });

  it('works with native JS predicate', async function() {
    const expr = await fumifier('$first([{"x":1},{"x":3}], $native)');
    expr.assign('native', function (v) { return v && v.x === 3; });
    const res = await expr.evaluate({});
    expect(res).to.deep.equal({ x: 3 });
  });

  it('works with native async JS predicate', async function() {
    const expr = await fumifier('$first([{"x":1},{"x":2},{"x":3}], $nativeAsync)');
    expr.assign('nativeAsync', async function (v) {
      // simulate async I/O
      await new Promise(resolve => setTimeout(resolve, 5));
      return v && v.x === 2;
    });
    const res = await expr.evaluate({});
    expect(res).to.deep.equal({ x: 2 });
  });

  it('short-circuits async predicates after the first match', async function() {
    const calls = [];
    const expr = await fumifier('$first([1,2,3,4], $nativeAsync)');
    expr.assign('nativeAsync', async function (value) {
      calls.push(value);
      await new Promise(resolve => setTimeout(resolve, 5));
      return value >= 2;
    });

    const res = await expr.evaluate({});

    expect(res).to.equal(2);
    expect(calls).to.deep.equal([1, 2]);
  });

  it('returns undefined when no item matches', async function() {
    const expr = await fumifier('[1,2] ~> $first(function($v){$v > 10})');
    const res = await expr.evaluate({});
    expect(res).to.equal(undefined);
  });
});
