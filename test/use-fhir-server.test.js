import fumifier from '../dist/index.mjs';
import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

const { expect, use } = chai;
use(chaiAsPromised);

/**
 * Create a minimal mock FHIR client for connection-routing tests.
 * @param {number} total - Bundle total returned from search.
 * @returns {Object} Minimal async FHIR client stub.
 */
function createClient(total) {
  return {
    async search() {
      return { total };
    },
    async getCapabilities() {
      return { resourceType: 'CapabilityStatement' };
    },
    async resourceId() {
      return 'id';
    },
    async resolve() {
      return { resourceType: 'Patient', id: 'id' };
    },
    async toLiteral() {
      return 'Patient/id';
    }
  };
}

describe('$useFhirServer', function() {
  it('switches to named connection within the current block', async function() {
    const defaultClient = createClient(1);
    const namedClient = createClient(2);
    const resolverCalls = [];

    const expr = await fumifier("($useFhirServer('myConn'); $search('Patient', {}).total)", {
      fhirClient: defaultClient,
      connectionResolver: (target, config) => {
        resolverCalls.push({ target, config });
        return target === 'myConn' ? namedClient : defaultClient;
      }
    });

    const result = await expr.evaluate({});
    expect(result).to.equal(2);
    expect(resolverCalls).to.deep.equal([{ target: 'myConn', config: undefined }]);
  });

  it('does not leak connection selection outside an inner block', async function() {
    const defaultClient = createClient(1);
    const namedClient = createClient(2);

    const expr = await fumifier("[$search('Patient', {}).total, ($useFhirServer('myConn'); $search('Patient', {}).total), $search('Patient', {}).total]", {
      fhirClient: defaultClient,
      connectionResolver: (target) => (target === 'myConn' ? namedClient : defaultClient)
    });

    const result = await expr.evaluate({});
    expect(result).to.deep.equal([1, 2, 1]);
  });

  it('resets back to default client when called with no arguments', async function() {
    const defaultClient = createClient(1);
    const namedClient = createClient(2);

    const expr = await fumifier("($useFhirServer('myConn'); [$search('Patient', {}).total, ($useFhirServer(); $search('Patient', {}).total)])", {
      fhirClient: defaultClient,
      connectionResolver: (target) => (target === 'myConn' ? namedClient : defaultClient)
    });

    const result = await expr.evaluate({});
    expect(result).to.deep.equal([2, 1]);
  });

  it('affects later array and object constructor entries in the same block', async function() {
    const defaultClient = createClient(1);
    const namedClient = createClient(2);

    const expr = await fumifier("($useFhirServer('myConn'); {'arrayTotals': [$search('Patient', {}).total, $search('Patient', {}).total], 'objectTotals': {'first': $search('Patient', {}).total, 'second': $search('Patient', {}).total}})", {
      fhirClient: defaultClient,
      connectionResolver: (target) => (target === 'myConn' ? namedClient : defaultClient)
    });

    const result = await expr.evaluate({});
    expect(result).to.deep.equal({
      arrayTotals: [2, 2],
      objectTotals: {
        first: 2,
        second: 2
      }
    });
  });

  it('affects later function-call arguments evaluated in the same lexical frame', async function() {
    const defaultClient = createClient(1);
    const namedClient = createClient(2);

    const expr = await fumifier("$capture($useFhirServer('myConn'), $search('Patient', {}).total)", {
      fhirClient: defaultClient,
      connectionResolver: (target) => (target === 'myConn' ? namedClient : defaultClient)
    });
    expr.registerFunction('capture', function(_modifier, value) {
      return value;
    });

    const result = await expr.evaluate({});
    expect(result).to.equal(2);
  });

  it('passes URL target and config object to the connection resolver', async function() {
    const defaultClient = createClient(1);
    const urlClient = createClient(3);
    const resolverCalls = [];

    const expr = await fumifier("($useFhirServer('http://public.fhir.org/r4', {'authType':'BASIC','username':'u','password':'p','fhirVersion':'4.0.1','timeout':1234}); $search('Patient', {}).total)", {
      fhirClient: defaultClient,
      connectionResolver: (target, config) => {
        resolverCalls.push({ target, config });
        return urlClient;
      }
    });

    const result = await expr.evaluate({});
    expect(result).to.equal(3);
    expect(resolverCalls).to.deep.equal([
      {
        target: 'http://public.fhir.org/r4',
        config: {
          authType: 'BASIC',
          username: 'u',
          password: 'p',
          fhirVersion: '4.0.1',
          timeout: 1234
        }
      }
    ]);
  });

  it('throws immediately when resolver cannot resolve a named connection', async function() {
    const defaultClient = createClient(1);

    const expr = await fumifier("$useFhirServer('nonExistent')", {
      fhirClient: defaultClient,
      connectionResolver: (target) => {
        throw new Error(`Unknown FHIR connection name: "${target}"`);
      }
    });

    try {
      await expr.evaluate({});
      expect.fail('Expected evaluation to reject');
    } catch (err) {
      expect(err.code).to.equal('D3201');
      expect(err.token).to.equal('useFhirServer');
      expect(err.message).to.equal('Failed to switch FHIR server to "nonExistent": Unknown FHIR connection name: "nonExistent"');
    }
  });

  it('throws when a target is provided without a connection resolver', async function() {
    const expr = await fumifier("$useFhirServer('nonExistent')");

    try {
      await expr.evaluate({});
      expect.fail('Expected evaluation to reject');
    } catch (err) {
      expect(err.code).to.equal('D3200');
      expect(err.token).to.equal('useFhirServer');
      expect(err.message).to.equal('Cannot switch FHIR server to "nonExistent": connection resolver is not configured.');
    }
  });

  it('resolves once at $useFhirServer and reuses the stored client for later FHIR helpers', async function() {
    const defaultClient = createClient(1);
    const namedClient = createClient(2);
    const resolverCalls = [];

    const expr = await fumifier("($useFhirServer('myConn'); [$search('Patient', {}).total, $capabilities().resourceType])", {
      fhirClient: defaultClient,
      connectionResolver: (target, config) => {
        resolverCalls.push({ target, config });
        return namedClient;
      }
    });

    const result = await expr.evaluate({});

    expect(result).to.deep.equal([2, 'CapabilityStatement']);
    expect(resolverCalls).to.deep.equal([{ target: 'myConn', config: undefined }]);
  });

  it('wraps plain resolver failures with D3201 details', async function() {
    const expr = await fumifier("$useFhirServer('myConn')", {
      connectionResolver: () => {
        throw new Error('boom');
      }
    });

    try {
      await expr.evaluate({});
      expect.fail('Expected evaluation to reject');
    } catch (err) {
      expect(err.code).to.equal('D3201');
      expect(err.token).to.equal('useFhirServer');
      expect(err.message).to.equal('Failed to switch FHIR server to "myConn": boom');
      expect(err.sourceMessage).to.equal('boom');
    }
  });

  it('preserves the populated message in evaluateVerbose diagnostics for resolver failures', async function() {
    const expr = await fumifier("$useFhirServer('public-hap')", {
      connectionResolver: (target) => {
        throw new Error(`Unknown FHIR connection name: "${target}"`);
      }
    });

    const report = await expr.evaluateVerbose({});

    expect(report.ok).to.equal(false);
    expect(report.status).to.equal(422);
    expect(report.diagnostics.error).to.have.lengthOf(1);
    expect(report.diagnostics.error[0]).to.include({
      code: 'D3201',
      token: 'useFhirServer',
      message: 'Failed to switch FHIR server to "public-hap": Unknown FHIR connection name: "public-hap"',
      sourceMessage: 'Unknown FHIR connection name: "public-hap"'
    });
  });

  it('keeps $translateCode on terminology runtime after switching FHIR servers', async function() {
    const defaultClient = createClient(1);
    const resolverCalls = [];
    const terminologyRuntime = {
      async translateConceptMap() {
        return {
          status: 'mapped',
          targets: [{ code: 'mapped-code', system: 'http://example.org/system' }]
        };
      }
    };

    const expr = await fumifier("($useFhirServer('myConn'); $translateCode('male', 'cm-example'))", {
      fhirClient: defaultClient,
      terminologyRuntime,
      connectionResolver: (target, config) => {
        resolverCalls.push({ target, config });
        return createClient(2);
      }
    });

    const result = await expr.evaluate({});
    expect(result).to.equal('mapped-code');
    expect(resolverCalls).to.deep.equal([{ target: 'myConn', config: undefined }]);
  });

  it('affects later object entries when the modifier is evaluated inside the object constructor', async function() {
    const defaultClient = createClient(1);
    const namedClient = createClient(2);

    const expr = await fumifier("({'switch': $useFhirServer('myConn'), 'total': $search('Patient', {}).total}).total", {
      fhirClient: defaultClient,
      connectionResolver: (target) => (target === 'myConn' ? namedClient : defaultClient)
    });

    const result = await expr.evaluate({});
    expect(result).to.equal(2);
  });
});
