import fumifier from '../dist/index.mjs';
import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

const { expect, use } = chai;
use(chaiAsPromised);

function createClient(resources) {
  return {
    async search(resourceType, params, options = {}) {
      const entries = resources.map((resource) => ({
        fullUrl: `https://example.test/${resourceType}/${resource.id}`,
        resource,
        search: { mode: 'match' }
      }));

      if (options.fetchAll) {
        if (typeof options.transform === 'function') {
          const transformed = [];
          for (let index = 0; index < entries.length; index++) {
            const entry = entries[index];
            const nextValue = await options.transform(entry.resource, entry.search.mode, index, entry);
            if (typeof nextValue !== 'undefined') {
              transformed.push(nextValue);
            }
          }
          return transformed;
        }

        return entries.map((entry) => entry.resource);
      }

      return {
        resourceType: 'Bundle',
        type: 'searchset',
        total: entries.length,
        entry: entries
      };
    },
    async getCapabilities() {
      return { resourceType: 'CapabilityStatement' };
    },
    async resourceId() {
      return resources[0]?.id;
    },
    async resolve() {
      return resources[0];
    },
    async toLiteral() {
      return `${resources[0]?.resourceType}/${resources[0]?.id}`;
    }
  };
}

describe('$search fetchAll transform bridge', function() {
  it('adapts expression-defined transform lambdas inside the options object', async function() {
    const client = createClient([
      { resourceType: 'Patient', id: 'p1' },
      { resourceType: 'Patient', id: 'p2' }
    ]);

    const expr = await fumifier("$search('Patient', {}, {'fetchAll': true, 'transform': function($resource, $mode, $index, $entry){$index = 0 ? {'id': $resource.id, 'mode': $mode, 'fullUrl': $entry.fullUrl} : undefined}})", {
      fhirClient: client
    });

    const res = await expr.evaluate({});

    expect(res).to.deep.equal([
      {
        id: 'p1',
        mode: 'match',
        fullUrl: 'https://example.test/Patient/p1'
      }
    ]);
  });

  it('leaves native JavaScript transform callbacks untouched', async function() {
    const client = createClient([
      { resourceType: 'Patient', id: 'p1' },
      { resourceType: 'Patient', id: 'p2' }
    ]);

    const expr = await fumifier("$search('Patient', {}, $options)", {
      fhirClient: client
    });
    expr.assign('options', {
      fetchAll: true,
      transform(resource, mode, index) {
        return `${resource.id}:${mode}:${index}`;
      }
    });

    const res = await expr.evaluate({});

    expect(res).to.deep.equal(['p1:match:0', 'p2:match:1']);
  });
});