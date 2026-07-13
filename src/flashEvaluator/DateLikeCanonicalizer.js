/*
Copyright (c) 2025 Outburn Ltd.
Project: Fumifier (part of the FUME open-source initiative)

License: See the LICENSE file included with this package for the terms that apply to this distribution.
*/

/**
 * @module DateLikeCanonicalizer
 * @description Strict validation/canonicalization for FHIR date-like primitives (date, dateTime, instant)
 */

import fn from '../utils/functions.js';
import FlashErrorGenerator from './FlashErrorGenerator.js';
import dateTime from '../utils/datetime.js';

// Precompiled regular expressions (hoisted to avoid recompilation per invocation)
const RE_FRAC = /\.\d+/;
const RE_T_SECS = /T\d{2}:\d{2}:\d{2}/;
const RE_T_MINUTES_A = /T\d{2}:\d{2}(?!:)/; // minutes but not seconds
const RE_T_MINUTES_B = /T\d{2}:\d{2}($|[^:])/; // minutes followed by EOL or non-:
const RE_TZ_ANY = /(Z|[+-]\d{2}:\d{2})$/i;
const RE_TZ_NUMERIC = /[+-]\d{2}:\d{2}$/;
const RE_TZ_CAPTURE = /([+-]\d{2}):(\d{2})$/;
const RE_YEAR_ONLY = /^\d{4}$/;
const RE_YEAR_MONTH = /^\d{4}-\d{2}$/;
const RE_T_24 = /T24:/;
const MAX_EPOCH_MILLIS = 8640000000000000;
const UTC_TIMEZONE = '0000';
const DATE_PICTURE = '[Y0001]-[M01]-[D01]';
const UTC_TIMESTAMP_PICTURE = '[Y0001]-[M01]-[D01]T[H01]:[m01]:[s01].[f001][Z01:01t]';

/**
 * Canonicalize a date-like primitive value according to FHIR + JSONata datetime semantics.
 * Handles: date | dateTime | instant
 *
 * Behavior:
 * - If policy band inhibits regex-level validation (F5110), returns original string (no parsing/truncation)
 * - Enforces FHIR-specific constraints (e.g., timezone presence rules, 24:00 disallowed)
 * - Parses to milliseconds using JSONata dateTime with appropriate picture based on input shape
 * - Formats back preserving precision and timezone form, performs round-trip check when applicable
 * - Returns canonical string or original string when downgraded by policy
 * - Throws via policy.enforce when applicable
 *
 * @param {Object} expr - Expression with FHIR context
 * @param {string|number} inputValue - Raw input value
 * @param {string} fhirTypeCode - One of 'date' | 'dateTime' | 'instant'
 * @param {string} elementFlashPath - For error reporting
 * @param {Object} environment - Execution environment
 * @param {Object} policy - Active policy instance
 * @returns {string} Canonicalized (or original) string
 */
export default class DateLikeCanonicalizer {
  /**
   * Helper method to create and handle F5111 validation errors consistently.
   * @param {Object} expr Expression with FHIR context for error reporting
   * @param {string} originalStr Original input string value
   * @param {string} elementFlashPath Element flash path for diagnostics
   * @param {('date'|'dateTime'|'instant')} fhirTypeCode The FHIR type code
   * @param {Object} policy Active validation policy
   * @returns {string} Returns originalStr if error is not enforced
   * @throws {Error} Throws error if policy enforces it
   */
  static _createF5111ErrorOrDowngrade(expr, originalStr, elementFlashPath, fhirTypeCode, policy) {
    const err = FlashErrorGenerator.createError('F5111', expr, {
      value: originalStr,
      fhirElement: elementFlashPath,
      fhirType: fhirTypeCode
    });
    if (policy.enforce(err)) throw err;
    return originalStr; // downgraded
  }

  /**
   * Canonicalize a FHIR date-like primitive value.
   * @param {Object} expr Expression with FHIR context for error reporting
   * @param {string|number} inputValue Input value to canonicalize
   * @param {('date'|'dateTime'|'instant')} fhirTypeCode The FHIR type code
   * @param {string} elementFlashPath Element flash path for diagnostics
   * @param {Object} environment Execution environment (used by jsonata datetime)
   * @param {Object} policy Active validation policy
   * @returns {string} Canonicalized value (or original when downgraded/inhibited)
   */
  static canonicalize(expr, inputValue, fhirTypeCode, elementFlashPath, environment, policy) {
    const originalStr = fn.string(inputValue);

    if (typeof inputValue === 'number') {
      if (!Number.isFinite(inputValue) || Math.abs(inputValue) > MAX_EPOCH_MILLIS) {
        return this._createF5111ErrorOrDowngrade(expr, originalStr, elementFlashPath, fhirTypeCode, policy);
      }

      if (fhirTypeCode === 'date') {
        return dateTime.fromMillis(inputValue, DATE_PICTURE, UTC_TIMEZONE);
      }

      return dateTime.fromMillis(inputValue, UTC_TIMESTAMP_PICTURE, UTC_TIMEZONE);
    }

    // If regex-band validation is inhibited entirely, keep original value (no parsing, no truncation)
    if (!policy.shouldValidate('F5110')) {
      return originalStr;
    }

    // Shape flags
    const hasT = originalStr.indexOf('T') !== -1;
    const hasFrac = RE_FRAC.test(originalStr);
    const fracLen = hasFrac ? (originalStr.match(RE_FRAC)[0].length - 1) : 0;
    const hasSeconds = RE_T_SECS.test(originalStr);
    const hasMinutes = RE_T_MINUTES_A.test(originalStr) || RE_T_MINUTES_B.test(originalStr) || hasSeconds || hasFrac;
    const hasTZ = RE_TZ_ANY.test(originalStr);
    const hasNumericTZ = RE_TZ_NUMERIC.test(originalStr);
    const tzMatch = originalStr.match(RE_TZ_CAPTURE);
    const timezoneArg = tzMatch ? `${tzMatch[1]}${tzMatch[2]}` : undefined;
    const isYearOnly = RE_YEAR_ONLY.test(originalStr);
    const isYearMonth = RE_YEAR_MONTH.test(originalStr);

    // Disallow 24:00 (and any hour starting with 24) per FHIR
    if (hasT && RE_T_24.test(originalStr)) {
      return this._createF5111ErrorOrDowngrade(expr, originalStr, elementFlashPath, fhirTypeCode, policy);
    }

    // Instant must include timezone (and implies seconds via parsing below)
    if (fhirTypeCode === 'instant' && !hasTZ) {
      return this._createF5111ErrorOrDowngrade(expr, originalStr, elementFlashPath, fhirTypeCode, policy);
    }

    // dateTime: if time is present, timezone SHALL be present
    if (fhirTypeCode === 'dateTime' && hasT) {
      if (!hasTZ) {
        return this._createF5111ErrorOrDowngrade(expr, originalStr, elementFlashPath, fhirTypeCode, policy);
      }
    }

    // Step 1: parse to millis. Try default ISO first; if that fails, try a picture tailored to the input shape
    let millis;
    let parsed = false;
    try {
      millis = dateTime.toMillis(originalStr);
      parsed = (typeof millis === 'number' && isFinite(millis));
    } catch (e) {
      parsed = false;
    }

    if (!parsed) {
      let parsePicture;
      if (fhirTypeCode === 'date') {
        if (!hasT) {
          if (isYearOnly) parsePicture = '[Y0001]';
          else if (isYearMonth) parsePicture = '[Y0001]-[M01]';
          else parsePicture = '[Y0001]-[M01]-[D01]';
        }
      } else if (fhirTypeCode === 'dateTime') {
        if (!hasT) {
          if (isYearOnly) parsePicture = '[Y0001]';
          else if (isYearMonth) parsePicture = '[Y0001]-[M01]';
          else parsePicture = '[Y0001]-[M01]-[D01]';
        } else {
          const tzPart = hasNumericTZ ? '[Z01:01]' : '';
          if (hasMinutes && !hasSeconds && !hasFrac) {
            parsePicture = `[Y0001]-[M01]-[D01]T[H01]:[m01]${tzPart}`;
          } else if (hasSeconds && !hasFrac) {
            parsePicture = `[Y0001]-[M01]-[D01]T[H01]:[m01]:[s01]${tzPart}`;
          } else if (hasFrac) {
            const fDigits = '0'.repeat(Math.max(1, Math.min(fracLen, 9)));
            parsePicture = `[Y0001]-[M01]-[D01]T[H01]:[m01]:[s01].[f${fDigits}]${tzPart}`;
          }
        }
      } else if (fhirTypeCode === 'instant') {
        // seconds (and optional fraction) with required timezone
        if (hasFrac) {
          const fDigits = '0'.repeat(Math.max(1, Math.min(fracLen, 9)));
          parsePicture = `[Y0001]-[M01]-[D01]T[H01]:[m01]:[s01].[f${fDigits}][Z01:01]`;
        } else {
          parsePicture = '[Y0001]-[M01]-[D01]T[H01]:[m01]:[s01][Z01:01]';
        }
      }

      if (parsePicture) {
        try {
          millis = dateTime.toMillis.call({ environment }, originalStr, parsePicture);
          parsed = (typeof millis === 'number' && isFinite(millis));
        } catch (e) {
          parsed = false;
        }
      }
    }

    if (!parsed) {
      return this._createF5111ErrorOrDowngrade(expr, originalStr, elementFlashPath, fhirTypeCode, policy);
    }

    // Step 2: format preserving user precision (and for 'date', allow truncation from datetime)
    if (fhirTypeCode === 'date') {
      const picture = isYearOnly ? '[Y0001]' : isYearMonth ? '[Y0001]-[M01]' : '[Y0001]-[M01]-[D01]';
      const formatted = dateTime.fromMillis(millis, picture);
      // Round-trip check only when original had no time; when truncating from dateTime, equality will differ by design
      if (!hasT && formatted !== originalStr) {
        this._createF5111ErrorOrDowngrade(expr, originalStr, elementFlashPath, fhirTypeCode, policy);
      }
      return formatted;
    }

    if (fhirTypeCode === 'dateTime') {
      if (!hasT) {
        const picture = isYearOnly ? '[Y0001]' : isYearMonth ? '[Y0001]-[M01]' : '[Y0001]-[M01]-[D01]';
        const formatted = dateTime.fromMillis(millis, picture);
        if (formatted !== originalStr) {
          this._createF5111ErrorOrDowngrade(expr, originalStr, elementFlashPath, fhirTypeCode, policy);
        }
        return formatted;
      }
      const tzPartOut = hasTZ ? '[Z01:01t]' : '';
      let picture;
      if (hasMinutes && !hasSeconds && !hasFrac) {
        picture = `[Y0001]-[M01]-[D01]T[H01]:[m01]${tzPartOut}`;
      } else if (hasSeconds && !hasFrac) {
        picture = `[Y0001]-[M01]-[D01]T[H01]:[m01]:[s01]${tzPartOut}`;
      } else {
        const fDigits = '0'.repeat(Math.max(1, Math.min(fracLen, 9)));
        picture = `[Y0001]-[M01]-[D01]T[H01]:[m01]:[s01].[f${fDigits}]${tzPartOut}`;
      }
      const formatted = dateTime.fromMillis(millis, picture, timezoneArg);
      if (formatted !== originalStr) {
        this._createF5111ErrorOrDowngrade(expr, originalStr, elementFlashPath, fhirTypeCode, policy);
      }
      return formatted;
    }

    // instant: timezone required; preserve fraction digits if present
    if (fhirTypeCode === 'instant') {
      let picture;
      if (hasFrac) {
        picture = `[Y0001]-[M01]-[D01]T[H01]:[m01]:[s01].[f${'0'.repeat(Math.max(1, Math.min(fracLen, 9)))}][Z01:01t]`;
      } else {
        picture = '[Y0001]-[M01]-[D01]T[H01]:[m01]:[s01][Z01:01t]';
      }
      const formatted = dateTime.fromMillis(millis, picture, timezoneArg);
      if (formatted !== originalStr) {
        this._createF5111ErrorOrDowngrade(expr, originalStr, elementFlashPath, fhirTypeCode, policy);
      }
      return formatted;
    }

    // Should not reach here for known date-like types; return original as fallback
    return originalStr;
  }
}
