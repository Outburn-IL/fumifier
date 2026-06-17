import fumifier from '../dist/index.mjs';
import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

const { expect, use } = chai;
use(chaiAsPromised);

describe('$safe HOF', function() {
  it('accepts the wrapped function from context via the signature - flag', async function() {
    const expr = await fumifier('($safeToMillis := $toMillis.$safe(); $safeToMillis("2025-01-02T03:04:05Z"))');
    const res = await expr.evaluate({});

    expect(res).to.deep.equal({
      ok: true,
      result: 1735787045000,
      error: undefined
    });
  });

  it('preserves native signature validation for wrapped context-supplied functions', async function() {
    const expr = await fumifier('($safeToMillis := $toMillis.$safe(); $safeToMillis(123))');
    const res = await expr.evaluate({});

    expect(res.ok).to.equal(false);
    expect(res.result).to.equal(undefined);
    expect(res.error.code).to.equal('T0410');
    expect(res.error.code).to.not.equal('D3110');
  });

  it('supports chaining and returns an ok result object on success', async function() {
    const expr = await fumifier('"hello" ~> $safe($uppercase)()');
    const res = await expr.evaluate({});

    expect(res).to.deep.equal({
      ok: true,
      result: 'HELLO',
      error: undefined
    });
  });

  it('works with saved mappings exposed as callables', async function() {
    const mappingCache = {
      async getKeys() {
        return ['shout'];
      },
      async get(key) {
        if (key !== 'shout') {
          throw new Error(`Unknown mapping: ${key}`);
        }
        return '$uppercase($)';
      }
    };

    const expr = await fumifier('$safe($shout)("hello")', { mappingCache });
    const res = await expr.evaluate({});

    expect(res).to.deep.equal({
      ok: true,
      result: 'HELLO',
      error: undefined
    });
  });

  it('preserves wrapped source details when a saved mapping fails to parse', async function() {
    const mappingCache = {
      async getKeys() {
        return ['syntaxError'];
      },
      async get(key) {
        if (key !== 'syntaxError') {
          throw new Error(`Unknown mapping: ${key}`);
        }
        return '$ + + $';
      }
    };

    const expr = await fumifier('$safe($syntaxError)("hello")', { mappingCache });
    const res = await expr.evaluate({});

    expect(res.ok).to.equal(false);
    expect(res.result).to.equal(undefined);
    expect(res.error.code).to.equal('F3002');
    expect(res.error.message).to.equal('Failed to parse mapping "syntaxError": Syntax error: symbol "+" used in a place where it is not allowed');
    expect(res.error.message).to.not.contain('[object Object]');
    expect(res.error.sourceMessage).to.be.a('string');
    expect(res.error.sourceMessage).to.not.equal(res.error.message);
    expect(res.error.sourceMessage).to.equal('Syntax error: symbol "+" used in a place where it is not allowed');
    expect(res.error.sourceErrorCode).to.be.a('string');
    expect(res.error.sourceErrorCode).to.not.equal('F3002');
  });

  it('sanitizes thrown errors instead of exposing raw nested objects', async function() {
    const expr = await fumifier('$safe($explode)("Patient", "123")');
    expr.assign('explode', async (resourceType, id) => {
      const err = new Error(`Lookup failed for ${resourceType}/${id}`);
      err.code = 'HTTP_500';
      err.status = 500;
      err.request = {
        method: 'GET',
        url: `https://example.test/${resourceType}/${id}`,
        headers: {
          authorization: 'secret'
        }
      };
      throw err;
    });

    const res = await expr.evaluate({});

    expect(res.ok).to.equal(false);
    expect(res.result).to.equal(undefined);
    expect(res.error).to.deep.equal({
      code: 'HTTP_500',
      message: 'Lookup failed for Patient/123',
      sourceMessage: 'Lookup failed for Patient/123',
      sourceErrorCode: 'HTTP_500',
      status: 500,
      request: {
        method: 'GET',
        url: 'https://example.test/Patient/123'
      }
    });
    expect(JSON.stringify(res.error)).not.to.contain('authorization');
    expect(Object.keys(res.error)).not.to.include('sourceError');
  });

  it('fails fast when given a non-callable', async function() {
    const expr = await fumifier('$safe(123)');

    try {
      await expr.evaluate({});
      expect.fail('Expected evaluation to reject');
    } catch (err) {
      expect(err.code).to.equal('T0410');
      expect(err.token).to.equal('safe');
    }
  });
});