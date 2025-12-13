/*
Copyright (c) 2025 Outburn Ltd.
Project: Fumifier (part of the FUME open-source initiative)

License: See the LICENSE file included with this package for the terms that apply to this distribution.
*/

/* eslint-disable no-console */
/* eslint-disable valid-jsdoc */
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

  // sanitize entry: remove stack from collected diagnostics
  const rest = { ...(entry || {}) };
  if (Object.prototype.hasOwnProperty.call(rest, 'stack')) delete rest.stack;

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
