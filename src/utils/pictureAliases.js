const FORMAT_PICTURE_ALIASES = {
  date: '[Y0001]-[M01]-[D01]',
  dateTime: '[Y0001]-[M01]-[D01]T[H01]:[m01]:[s01][Z01:01t]',
  instant: '[Y0001]-[M01]-[D01]T[H01]:[m01]:[s01].[f001][Z01:01t]',
  time: '[H01]:[m01]:[s01].[f001]'
};

/**
 * Resolves exact format-picture aliases to their underlying picture strings.
 * @param {string | undefined} picture - Candidate alias or raw picture string.
 * @returns {string | undefined} The aliased or original picture value.
 */
export default function resolveFormatPictureAlias(picture) {
  if (typeof picture === 'undefined') {
    return undefined;
  }

  return FORMAT_PICTURE_ALIASES[picture] ?? picture;
}