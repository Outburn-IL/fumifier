import fumifier from '../dist/index.mjs';
import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

const { expect, use } = chai;
use(chaiAsPromised);

describe('$memoize HOF', function() {
  it('accepts the wrapped function from context via the signature - flag', async function() {
    let callCount = 0;
    const expr = await fumifier('($memoUpper := $uppercase.$memoize(); [$memoUpper("hello"), $memoUpper("hello")])');
    expr.assign('uppercase', (value) => {
      callCount += 1;
      return String(value).toUpperCase();
    });

    const res = await expr.evaluate({});

    expect(res).to.deep.equal(['HELLO', 'HELLO']);
    expect(callCount).to.equal(1);
  });

  it('reuses cached results within one evaluation and resets across evaluations', async function() {
    let callCount = 0;
    const expr = await fumifier('($memo := $memoize($counted); [$memo(1), $memo(1), $memo(2)])');
    expr.assign('counted', (value) => {
      callCount += 1;
      return value * 10;
    });

    const first = await expr.evaluate({});
    const second = await expr.evaluate({});

    expect(first).to.deep.equal([10, 10, 20]);
    expect(second).to.deep.equal([10, 10, 20]);
    expect(callCount).to.equal(4);
  });

  it('shares the same in-flight promise for duplicate async arguments', async function() {
    let callCount = 0;
    const expr = await fumifier('($memo := $memoize($countedAsync); $pMap([1,1,2,2], $memo))');
    expr.assign('countedAsync', async (value) => {
      callCount += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      return value * 10;
    });

    const res = await expr.evaluate({});

    expect(res).to.deep.equal([10, 10, 20, 20]);
    expect(callCount).to.equal(2);
  });

  it('distinguishes non-finite numbers and negative zero in memoize cache keys', async function() {
    let callCount = 0;
    const expr = await fumifier('($memo := $memoize($describe); [$memo($nan), $memo($inf), $memo($negInf), $memo($negZero), $memo($zero)])');
    expr.assign('nan', NaN);
    expr.assign('inf', Infinity);
    expr.assign('negInf', -Infinity);
    expr.assign('negZero', -0);
    expr.assign('zero', 0);
    expr.assign('describe', (value) => {
      callCount += 1;
      if (Number.isNaN(value)) return 'nan';
      if (value === Infinity) return 'inf';
      if (value === -Infinity) return '-inf';
      if (Object.is(value, -0)) return '-0';
      if (value === 0) return '0';
      return String(value);
    });

    const res = await expr.evaluate({});

    expect(res).to.deep.equal(['nan', 'inf', '-inf', '-0', '0']);
    expect(callCount).to.equal(5);
  });

  it('does not cache rejected results and retries after failure', async function() {
    let callCount = 0;
    const expr = await fumifier('($memo := $memoize($flaky); $first := $safe($memo)(1); $second := $safe($memo)(1); $third := $safe($memo)(1); [$first, $second, $third])');
    expr.assign('flaky', async (value) => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error('boom');
      }
      return value * 2;
    });

    const res = await expr.evaluate({});

    expect(res[0]).to.deep.equal({
      ok: false,
      result: undefined,
      error: {
        message: 'boom',
        sourceMessage: 'boom'
      }
    });
    expect(res[1]).to.deep.equal({
      ok: true,
      result: 2,
      error: undefined
    });
    expect(res[2]).to.deep.equal({
      ok: true,
      result: 2,
      error: undefined
    });
    expect(callCount).to.equal(2);
  });

  it('rejects unstable function-valued cache keys with a clear runtime error', async function() {
    const expr = await fumifier('($memo := $memoize(function($value){$value}); $memo(function($v){$v}))');

    try {
      await expr.evaluate({});
      expect.fail('Expected evaluation to reject');
    } catch (err) {
      expect(err.code).to.equal('D3142');
      expect(err.message).to.equal('$memoize() arguments cannot contain functions or symbols. Received: "$function"');
    }
  });
});