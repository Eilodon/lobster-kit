import vm from 'node:vm';

type SandboxResult = {
    mode: 'heuristic';
    output: string;
    confidence: number;
};

const SCRIPT_SOURCE = `
(() => {
  const text = String(payload || '').trim();
  const lowerNeed = String(need || '').toLowerCase();
  const capList = Array.isArray(capabilities) ? capabilities.map((c) => String(c).toLowerCase()) : [];
  const caps = new Set(capList);

  let output = text || 'No payload provided.';
  let confidence = 0.45;

  if (caps.has('summarization') || lowerNeed.includes('summary') || lowerNeed.includes('summarize')) {
    output = text.length <= 360 ? text : (text.slice(0, 180) + ' ... ' + text.slice(-140));
    confidence = 0.6;
  } else if (caps.has('classification') || lowerNeed.includes('classify') || lowerNeed.includes('label')) {
    const lowered = text.toLowerCase();
    let label = 'neutral';
    if (/(error|fail|incident|critical|urgent|panic)/.test(lowered)) label = 'high_risk';
    else if (/(warn|slow|delay|retry|degraded)/.test(lowered)) label = 'medium_risk';
    else if (/(ok|done|stable|success)/.test(lowered)) label = 'low_risk';
    output = 'classification=' + label;
    confidence = 0.55;
  } else if (caps.has('transformation') || lowerNeed.includes('extract') || lowerNeed.includes('transform')) {
    output = text.split('\\n').map((line) => line.trim()).filter(Boolean).slice(0, 10).join(' | ');
    confidence = 0.5;
  }

  return {
    mode: 'heuristic',
    output: String(output || '').slice(0, 4000),
    confidence: Math.max(0, Math.min(1, Number(confidence) || 0.45)),
  };
})()
`;

export function runSandboxedGeneratedTool(
    payload: string,
    need: string,
    capabilities: string[]
): SandboxResult {
    const script = new vm.Script(SCRIPT_SOURCE, { filename: 'generated-tool-sandbox.js' });
    const context = vm.createContext({
        payload,
        need,
        capabilities,
    });
    const result = script.runInContext(context, { timeout: 40 });
    if (!result || typeof result !== 'object') {
        return {
            mode: 'heuristic',
            output: String(payload || '').slice(0, 4000) || 'No payload provided.',
            confidence: 0.4,
        };
    }
    const casted = result as Partial<SandboxResult>;
    return {
        mode: 'heuristic',
        output: String(casted.output ?? '').slice(0, 4000) || 'No payload provided.',
        confidence: Math.max(0, Math.min(1, Number(casted.confidence ?? 0.4))),
    };
}
