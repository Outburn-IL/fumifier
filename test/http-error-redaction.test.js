import fumifier from '../dist/index.mjs';
import * as chai from 'chai';

const { expect } = chai;

function createTransportLikeError({
  message,
  status,
  request,
  operationOutcome,
  extra = {}
}) {
  const err = new Error(message);
  err.name = 'FhirClientError';
  err.code = 'FhirClientError';
  if (typeof status === 'number') err.status = status;
  if (request) err.request = request;
  if (operationOutcome) err.operationOutcome = operationOutcome;
  Object.assign(err, extra);
  return err;
}

describe('HTTP error redaction', function() {
  it('does not emit raw nested FHIR client errors in verbose diagnostics', async function() {
    const expr = await fumifier("$literal('Patient', {'identifier':'http://test|123'})", {
      fhirClient: {
        async toLiteral() {
          throw createTransportLikeError({
            message: 'upstream unauthorized',
            status: 401,
            request: {
              method: 'GET',
              url: 'Patient?identifier=http%3A%2F%2Ftest%7C123'
            },
            operationOutcome: {
              resourceType: 'OperationOutcome',
              issue: [{ severity: 'error' }]
            },
            extra: {
              config: {
                auth: { username: 'secret-user', password: 'secret-pass' },
                headers: { authorization: 'Basic c2VjcmV0LXVzZXI6c2VjcmV0LXBhc3M=' }
              }
            }
          });
        }
      }
    });

    const report = await expr.evaluateVerbose({});
    const diagnostic = report.diagnostics.error[0];

    expect(report.ok).to.equal(false);
    expect(report.status).to.equal(206);
    expect(diagnostic).to.include({
      code: 'F5203',
      operation: 'literal',
      errorMessage: 'upstream unauthorized',
      sourceMessage: 'upstream unauthorized',
      sourceErrorCode: 'FhirClientError',
      status: 401
    });
    expect(diagnostic.request).to.deep.equal({
      method: 'GET',
      url: 'Patient?identifier=http%3A%2F%2Ftest%7C123'
    });
    expect(diagnostic.operationOutcome).to.deep.equal({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error' }]
    });

    const serialized = JSON.stringify(diagnostic);
    expect(serialized).not.to.contain('secret-user');
    expect(serialized).not.to.contain('secret-pass');
    expect(serialized).not.to.contain('Basic c2VjcmV0LXVzZXI6c2VjcmV0LXBhc3M=');
    expect(serialized).not.to.contain('"sourceError"');
    expect(serialized).not.to.contain('"config"');
    expect(serialized).not.to.contain('"auth"');
  });

  it('maps top-level FhirClientError 404s to F5210 without exposing raw nested cause', async function() {
    const expr = await fumifier("$resolve('Patient/123')", {
      fhirClient: {
        async resolve() {
          throw createTransportLikeError({
            message: 'FHIR request failed with status 404',
            status: 404,
            request: {
              method: 'GET',
              url: 'Patient/123',
              resourceType: 'Patient',
              id: '123'
            },
            extra: {
              response: {
                status: 404,
                data: {
                  resourceType: 'OperationOutcome',
                  issue: [{ severity: 'error' }]
                },
                headers: { authorization: 'Basic should-not-leak' }
              }
            }
          });
        }
      }
    });

    const report = await expr.evaluateVerbose({});
    const diagnostic = report.diagnostics.error[0];

    expect(report.ok).to.equal(false);
    expect(report.status).to.equal(206);
    expect(diagnostic).to.include({
      code: 'F5210',
      resourceType: 'Patient',
      resourceId: '123',
      status: 404
    });

    const serialized = JSON.stringify(diagnostic);
    expect(serialized).not.to.contain('"sourceError"');
    expect(serialized).not.to.contain('Basic should-not-leak');
  });

  it('keeps search-style 404s as generic F5203 errors when no concrete resource id is available', async function() {
    const expr = await fumifier("$literal('Patient', {'identifier':'http://test|123'})", {
      fhirClient: {
        async toLiteral() {
          throw createTransportLikeError({
            message: 'FHIR request failed with status 404',
            status: 404,
            request: {
              method: 'GET',
              url: 'Patient?identifier=http%3A%2F%2Ftest%7C123',
              resourceType: 'Patient'
            },
            extra: {
              response: {
                status: 404,
                headers: { authorization: 'Basic should-not-leak' }
              }
            }
          });
        }
      }
    });

    const report = await expr.evaluateVerbose({});
    const diagnostic = report.diagnostics.error[0];

    expect(report.ok).to.equal(false);
    expect(report.status).to.equal(206);
    expect(diagnostic).to.include({
      code: 'F5203',
      operation: 'literal',
      status: 404
    });
    expect(diagnostic).not.to.have.property('resourceId');

    const serialized = JSON.stringify(diagnostic);
    expect(serialized).not.to.contain('undefined');
    expect(serialized).not.to.contain('Basic should-not-leak');
  });

  it('does not emit raw nested eval wrapper errors in verbose diagnostics', async function() {
    const expr = await fumifier('$eval("$boom()")');
    expr.registerFunction('boom', function() {
      const err = new Error('inner unauthorized');
      err.config = {
        auth: { username: 'secret-user', password: 'secret-pass' },
        headers: { authorization: 'Basic c2VjcmV0' }
      };
      err.cause = {
        auth: { username: 'secret-user', password: 'secret-pass' },
        headers: { authorization: 'Basic c2VjcmV0' }
      };
      throw err;
    });

    const report = await expr.evaluateVerbose({});
    const diagnostic = report.diagnostics.error[0];

    expect(report.ok).to.equal(false);
    expect(report.status).to.equal(422);
    expect(diagnostic).to.include({
      code: 'D3121',
      sourceMessage: 'inner unauthorized'
    });

    const serialized = JSON.stringify(diagnostic);
    expect(serialized).not.to.contain('secret-user');
    expect(serialized).not.to.contain('secret-pass');
    expect(serialized).not.to.contain('Basic c2VjcmV0');
    expect(serialized).not.to.contain('"error"');
    expect(serialized).not.to.contain('"cause"');
    expect(serialized).not.to.contain('"config"');
    expect(serialized).not.to.contain('"auth"');
  });
});