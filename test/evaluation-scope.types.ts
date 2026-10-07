import fumifier, {
  defineFunction,
  getBuiltinBindingNames,
  getReservedBindingNames,
  parseSignatureStructure,
  type EvaluationScope,
  type MappingDefinition,
  type NativeInvocationContext,
  type RuntimeOptions,
} from 'fumifier';
import { parse } from 'fumifier/browser';

const scope: EvaluationScope = {
  bindings: { prefix: 'value' },
  mappingCache: {
    async getKeys() { return ['mapping']; },
    async get() { return '$'; },
    async getDefinition(): Promise<MappingDefinition> { return { expression: '$', scope }; },
  },
};
const options: RuntimeOptions = { evaluationScope: scope, signal: new AbortController().signal };
const native = defineFunction(async function(this: NativeInvocationContext, input: string) {
  return this.evaluateMapping({ expression: '$', scope }, input, { prefix: 'call' }, { signal: options.signal });
}, '<s:x>');
scope.bindings.native = native;
const compiled = await fumifier('$native($)');
await compiled.evaluate('input', {}, options);
compiled.registerFunction('callback', async function(input) {
  return this.evaluateMapping({ expression: '$', scope }, input);
});
const names: string[] = getBuiltinBindingNames();
const reserved: string[] = getReservedBindingNames();
void reserved;
const signature = parseSignatureStructure('<s?o?:x>');
const optional: boolean = signature.arguments[0].optional;
const hasFunction: boolean = signature.hasFunctionType;
parse('$uppercase($)');
void names;
void optional;
void hasFunction;

// @ts-expect-error Scope requires a callable mapping cache.
const invalidScope: EvaluationScope = { bindings: {} };
// @ts-expect-error Cancellation requires an AbortSignal.
const invalidOptions: RuntimeOptions = { signal: true };
void invalidScope;
void invalidOptions;