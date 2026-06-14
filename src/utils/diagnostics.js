/*
Copyright (c) 2025 Outburn Ltd.
Project: Fumifier (part of the FUME open-source initiative)

License: See the LICENSE file included with this package for the terms that apply to this distribution.
*/

/* eslint-disable no-console */

// Diagnostics infrastructure for FLASH (F5xxx policy-governed) and user logging
// Lower value = more critical. Supports decimal severities.

/**
 * Common numeric levels. Lower value = more critical.
 * @typedef {{fatal:number,invalid:number,error:number,warning:number,notice:number,info:number,debug:number}} Levels
 */
export const LEVELS = {
  fatal: 0,
  invalid: 10,
  error: 20,
  warning: 30,
  notice: 40,
  info: 50,
  debug: 60
};

/**
 * Default console-based logger. Message-only API.
 * @returns {import('@outburn/types').Logger} Logger with debug/info/warn/error methods.
 */
export function createDefaultLogger() {
  return {
    debug: (msg) => console.debug(`[DEBUG] ${msg}`),
    info:  (msg) => console.info(`[INFO ] ${msg}`),
    warn:  (msg) => console.warn(`[WARN ] ${msg}`),
    error: (msg) => console.error(`[ERROR] ${msg}`)
  };
}

// Internal symbols for environment bindings (not accessible from expressions)
export const SYM = {
  diagnostics: Symbol.for('fumifier.__diagnostics'),
  logger: Symbol.for('fumifier.__logger')
};

/**
 * Map error code to severity. Non-F5 are always fatal (0). F5xyy => parseInt("xy").
 * @param {string} code Error code such as F5320.
 * @returns {number} Numeric severity level.
 */
export function severityFromCode(code) {
  if (!code || code[0] !== 'F') return LEVELS.fatal;
  if (code[1] !== '5') return LEVELS.fatal;
  const band = parseInt(code.slice(2, 4), 10);
  if (Number.isFinite(band)) return band;
  return LEVELS.error;
}

/**
 * Translate a numeric severity into a canonical level name.
 * @param {number} sev Numeric severity value.
 * @returns {'fatal'|'invalid'|'error'|'warning'|'notice'|'info'|'debug'} Level name.
 */
export function severityName(sev) {
  if (sev < LEVELS.invalid) return 'fatal';
  if (sev < LEVELS.error) return 'invalid';
  if (sev < LEVELS.warning) return 'error';
  if (sev < LEVELS.notice) return 'warning';
  if (sev < LEVELS.info) return 'notice';
  if (sev < LEVELS.debug) return 'info';
  return 'debug';
}

/**
 * Convert a level string or number to numeric severity if possible.
 * @param {string|number|undefined} level Level name or numeric value.
 * @returns {number|undefined} Numeric severity, or undefined if not resolvable.
 */
export function toNumericSeverity(level) {
  if (typeof level === 'number') return level;
  if (typeof level === 'string' && Object.prototype.hasOwnProperty.call(LEVELS, level)) {
    return LEVELS[level];
  }
  return undefined;
}

/**
 * Read current thresholds from environment variables (scoped), with defaults.
 * @param {{lookup:function(*):*}} env Execution environment providing lookup(name).
 * @returns {{throwLevel:number,logLevel:number,collectLevel:number,validationLevel:number}} Thresholds.
 */
export function thresholds(env) {
  const getNum = (name, fallback) => {
    try {
      const v = env && env.lookup && env.lookup(name);
      return typeof v === 'number' ? v : fallback;
    } catch {
      return fallback;
    }
  };
  return {
    // With exclusive comparisons (sev < threshold), set defaults to the start of the next band
    throwLevel: getNum('throwLevel', 30),      // throw for fatal/invalid/error (sev < 30)
    logLevel: getNum('logLevel', 40),          // log for warning and above (sev < 40)
    collectLevel: getNum('collectLevel', 70),  // collect all (sev < 70)
    validationLevel: getNum('validationLevel', 30) // validate for fatal/invalid/error (sev < 30)
  };
}

/**
 * Get current logger (or the default one if none was set on the environment).
 * @param {{lookup:function(*):*}} env Execution environment providing lookup(Symbol).
 * @returns {object} Logger instance.
 */
export function getLogger(env) {
  return (env && env.lookup && env.lookup(SYM.logger)) || createDefaultLogger();
}

/**
 * Determine whether a value is a non-null object.
 * @param {*} value - Value to inspect.
 * @returns {boolean} True when the value can carry object properties.
 */
function isObjectLike(value) {
  return value !== null && typeof value === 'object';
}

/**
 * Check whether a value is a FHIR OperationOutcome resource.
 * @param {*} value - Candidate value.
 * @returns {boolean} True when the value is an OperationOutcome-like object.
 */
function isOperationOutcome(value) {
  return isObjectLike(value) && value.resourceType === 'OperationOutcome';
}

/**
 * Copy only safe request metadata from an error request descriptor.
 * @param {*} request - Request metadata attached to an error.
 * @returns {object|undefined} Sanitized request summary when available.
 */
function sanitizeRequest(request) {
  if (!isObjectLike(request)) return undefined;

  const sanitized = {};
  if (typeof request.method === 'string') sanitized.method = request.method;
  if (typeof request.url === 'string') sanitized.url = request.url;
  if (typeof request.resourceType === 'string') sanitized.resourceType = request.resourceType;
  if (typeof request.id === 'string') sanitized.id = request.id;

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

/**
 * Build a safe summary of a nested source error for diagnostic exposure.
 * @param {*} sourceError - Original nested error or error-like value.
 * @returns {object|undefined} Safe summary fields that may be exposed publicly.
 */
function summarizeSourceError(sourceError) {
  if (!isObjectLike(sourceError)) {
    if (typeof sourceError === 'undefined') return undefined;
    return { message: String(sourceError) };
  }

  const summary = {};

  if (typeof sourceError.name === 'string') summary.name = sourceError.name;
  if (typeof sourceError.code === 'string') summary.code = sourceError.code;
  if (typeof sourceError.message === 'string') summary.message = sourceError.message;

  let status;
  if (typeof sourceError.status === 'number') {
    status = sourceError.status;
  } else if (typeof sourceError.response?.status === 'number') {
    status = sourceError.response.status;
  }
  if (typeof status === 'number') summary.status = status;

  const request = sanitizeRequest(sourceError.request);
  if (request) summary.request = request;

  let operationOutcome;
  if (isOperationOutcome(sourceError.operationOutcome)) {
    operationOutcome = sourceError.operationOutcome;
  } else if (isOperationOutcome(sourceError.response?.data)) {
    operationOutcome = sourceError.response.data;
  }
  if (operationOutcome) summary.operationOutcome = operationOutcome;

  return Object.keys(summary).length > 0 ? summary : undefined;
}

/**
 * Copy safe source-error metadata onto a target without retaining the raw nested error.
 * @param {object} target - Error or diagnostic object being enriched.
 * @param {*} sourceError - Original nested error or error-like value.
 * @returns {object} The same target object after enrichment.
 */
function copySafeErrorMetadata(target, sourceError) {
  if (!isObjectLike(target) || typeof sourceError === 'undefined') return target;

  const summary = summarizeSourceError(sourceError);
  if (summary) {
    if (typeof target.sourceMessage === 'undefined' && typeof summary.message === 'string') {
      target.sourceMessage = summary.message;
    }
    if (typeof target.sourceErrorCode === 'undefined' && typeof summary.code === 'string') {
      target.sourceErrorCode = summary.code;
    }
    if (typeof target.status === 'undefined' && typeof summary.status === 'number') {
      target.status = summary.status;
    }
    if (typeof target.request === 'undefined' && summary.request) {
      target.request = summary.request;
    }
    if (typeof target.operationOutcome === 'undefined' && summary.operationOutcome) {
      target.operationOutcome = summary.operationOutcome;
    }
  } else if (typeof target.sourceMessage === 'undefined') {
    target.sourceMessage = String(sourceError);
  }

  return target;
}

/**
 * Attach safe source-error metadata while keeping the raw cause non-enumerable.
 * @param {object} target - Error or diagnostic object being enriched.
 * @param {*} sourceError - Original nested error value.
 * @returns {object} The same target object after enrichment.
 */
export function attachSourceErrorMetadata(target, sourceError) {
  if (!isObjectLike(target) || typeof sourceError === 'undefined') return target;

  copySafeErrorMetadata(target, sourceError);

  try {
    Object.defineProperty(target, 'sourceError', {
      value: sourceError,
      enumerable: false,
      configurable: true,
      writable: true
    });
  } catch (_) {
    /* ignore */
  }

  return target;
}

/**
 * Remove non-public fields from a diagnostic entry before collection.
 * @param {*} entry - Diagnostic entry or error-like value.
 * @returns {object} Sanitized diagnostic object safe for verbose reporting.
 */
export function sanitizeDiagnosticEntry(entry) {
  const source = isObjectLike(entry) ? entry : {};
  const rest = { ...(entry || {}) };
  if (entry instanceof Error || (typeof entry?.message === 'string' && !Object.prototype.hasOwnProperty.call(rest, 'message'))) {
    rest.message = entry.message;
  }
  if (Object.prototype.hasOwnProperty.call(source, 'sourceError')) {
    copySafeErrorMetadata(rest, source.sourceError);
  }
  if (Object.prototype.hasOwnProperty.call(source, 'error')) {
    copySafeErrorMetadata(rest, source.error);
  }
  if (Object.prototype.hasOwnProperty.call(source, 'cause')) {
    copySafeErrorMetadata(rest, source.cause);
  }
  if (Object.prototype.hasOwnProperty.call(rest, 'stack')) delete rest.stack;
  if (Object.prototype.hasOwnProperty.call(rest, 'sourceError')) delete rest.sourceError;
  if (Object.prototype.hasOwnProperty.call(rest, 'error')) delete rest.error;
  if (Object.prototype.hasOwnProperty.call(rest, 'cause')) delete rest.cause;
  return rest;
}

/**
 * Decide actions under current thresholds for a given error code.
 * @param {string} code Error code like F5320.
 * @param {{lookup:function(*):*}} env Execution environment.
 * @returns {{severity:number,shouldThrow:boolean,shouldLog:boolean,shouldCollect:boolean}} Decision flags.
 */
export function decide(code, env) {
  const sev = severityFromCode(code);
  const { throwLevel, logLevel, collectLevel } = thresholds(env);
  return {
    severity: sev,
    shouldThrow: sev < throwLevel,
    shouldLog: sev < logLevel,
    shouldCollect: sev < collectLevel
  };
}

/**
 * Push a diagnostic entry into the per-evaluation bag if within collectLevel.
 * Buckets: error (fatal+invalid+error), warning (warning), debug (notice+info+debug).
 * Strips stack traces from collected entries.
 * @param {*} env The execution environment.
 * @param {*} entry The diagnostic entry.
 * @returns {void}
 */
export function push(env, entry) {
  const bag = env && env.lookup && env.lookup(SYM.diagnostics);
  if (!bag) return;
  const sev = severityFromCode(entry.code);
  const { collectLevel } = thresholds(env);
  if (sev >= collectLevel) return;

  // Bucket assignment: group related severities for user consumption
  let bucket;
  if (sev < LEVELS.warning) {
    bucket = 'error'; // fatal, invalid, error → all critical issues
  } else if (sev < LEVELS.notice) {
    bucket = 'warning'; // warning → actionable but not critical
  } else {
    bucket = 'debug'; // notice, info, debug → informational
  }

  // sanitize entry before collecting diagnostics
  const rest = sanitizeDiagnosticEntry(entry);

  // dedupe: ensure we don't collect identical diagnostics multiple times
  const seen = (() => {
    if (!bag.__seen) {
      try { Object.defineProperty(bag, '__seen', { value: new Set(), enumerable: false }); } catch (_) { /* ignore */ }
    }
    return bag.__seen;
  })();
  const dedupeKey = [
    rest.code || '',
    rest.fhirParent || '',
    rest.fhirElement || '',
    String(rest.position ?? ''),
    String(rest.start ?? ''),
    String(rest.line ?? ''),
    rest.message || '',
    bucket
  ].join('|');
  if (seen && seen.has(dedupeKey)) return;

  const withTs = {
    ...rest,
    // keep numeric severity for internal consumers
    severity: sev,
    // expose level name for users
    level: severityName(sev),
    timestamp: Date.now()
  };
  (bag[bucket] || (bag[bucket] = [])).push(withTs);
  if (seen) seen.add(dedupeKey);
}
