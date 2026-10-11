import fumifier, { FumifierError, defineFunction, parseSignatureStructure } from '../fumifier.js';

fumifier.FumifierError = FumifierError;
fumifier.defineFunction = defineFunction;
fumifier.parseSignatureStructure = parseSignatureStructure;

export default fumifier;