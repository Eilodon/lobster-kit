import { describe, expect, it } from 'vitest';
import { CausalBrain, SentinelVariable } from '../src/eidolon/ai/CausalBrain';

type LearnEvent = {
  cause: SentinelVariable;
  effect: SentinelVariable;
  positive: boolean;
};

const EVENTS: LearnEvent[] = [
  { cause: 'WhaleNetFlow', effect: 'PriceDelta', positive: true },
  { cause: 'WhaleNetFlow', effect: 'PriceDelta', positive: true },
  { cause: 'WhaleNetFlow', effect: 'PriceDelta', positive: false },
  { cause: 'MempoolPendingCnt', effect: 'GasPriceGwei', positive: true },
  { cause: 'MempoolPendingCnt', effect: 'GasPriceGwei', positive: false },
  { cause: 'Sentiment', effect: 'PriceDelta', positive: true },
  { cause: 'Sentiment', effect: 'PriceDelta', positive: false },
  { cause: 'Sentiment', effect: 'PriceDelta', positive: false }
];

const PAIRS: Array<[SentinelVariable, SentinelVariable]> = [
  ['WhaleNetFlow', 'PriceDelta'],
  ['MempoolPendingCnt', 'GasPriceGwei'],
  ['Sentiment', 'PriceDelta']
];

describe('CausalBrain TS-vs-Rust consistency', () => {
  it('should produce equivalent predictions after identical learning stream', () => {
    const hybrid = new CausalBrain();
    const tsOnly = new CausalBrain();

    // Force TS secondary path for baseline comparison.
    (tsOnly as any).wasmGraph = null;

    for (const event of EVENTS) {
      hybrid.learn(event.cause, event.effect, event.positive);
      tsOnly.learn(event.cause, event.effect, event.positive);
    }

    for (const [cause, effect] of PAIRS) {
      const rustPred = hybrid.getPrediction(cause, effect);
      const tsPred = tsOnly.getPrediction(cause, effect);

      expect(rustPred.prob).toBeCloseTo(tsPred.prob, 6);
      expect(rustPred.confidence).toBeCloseTo(tsPred.confidence, 6);
    }
  });

  it('should export consistent synaptic map keys for canonical edges', () => {
    const hybrid = new CausalBrain();
    const tsOnly = new CausalBrain();
    (tsOnly as any).wasmGraph = null;

    for (const event of EVENTS) {
      hybrid.learn(event.cause, event.effect, event.positive);
      tsOnly.learn(event.cause, event.effect, event.positive);
    }

    const rustMap = hybrid.getSynapticMap();
    const tsMap = tsOnly.getSynapticMap();

    for (const [cause, effect] of PAIRS) {
      const key = `${cause}->${effect}`;
      expect(rustMap[key]).toBeDefined();
      expect(tsMap[key]).toBeDefined();
      expect(rustMap[key].s).toBe(tsMap[key].s);
      expect(rustMap[key].f).toBe(tsMap[key].f);
      expect(rustMap[key].p).toBeCloseTo(tsMap[key].p, 2);
    }
  });
});
