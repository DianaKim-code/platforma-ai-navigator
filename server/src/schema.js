import { validateAnalysisResponse } from '../../src/schema.js';

export function assertAnalysis(value, practices) {
  const ids = new Set(practices.map((item) => item.id));
  const validation = validateAnalysisResponse(value, ids);
  if (!validation.ok) throw new Error(`Invalid provider response: ${validation.errors.join(',')}`);
  return validation.value;
}
