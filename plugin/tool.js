'use strict';
module.exports = {
  name: 'governance',
  description: 'Repository governance. init preserves existing files; status reads STATE.json; start needs id, goal, criteria; progress needs current,next,blocked; context needs layer,files,reason for escalation; verify needs passed,accepted,evidence,diffReview,files; gate needs delta and five decisions; close archives only after gates. route returns advisory model tier. Read plugin README for full workflow. Never claim this tool runs tests or globally intercepts other tools.',
  risk: 'medium',
  schema: {
    type: 'object', additionalProperties: false, required: ['action'],
    properties: {
      action: { type: 'string', enum: ['init', 'status', 'start', 'progress', 'context', 'route', 'verify', 'gate', 'close'] },
      id: { type: 'string' }, goal: { type: 'string' }, criteria: { type: 'array', items: { type: 'string' } },
      current: { type: 'string' }, next: { type: 'array', items: { type: 'string' } }, blocked: { type: 'array', items: { type: 'string' } },
      layer: { type: 'string', enum: ['docs', 'contract', 'notes', 'source'] }, reason: { type: 'string' },
      files: { type: 'array', items: { type: 'string' } }, passed: { type: 'boolean' }, accepted: { type: 'array', items: { type: 'boolean' } },
      evidence: { type: 'string' }, diffReview: { type: 'string' }, delta: { type: 'string' },
      features: { type: 'object', properties: { files: { type: 'integer', minimum: 0 }, modules: { type: 'integer', minimum: 0 }, research: { type: 'boolean' }, architecture: { type: 'boolean' }, interfaceChange: { type: 'boolean' }, unknownCause: { type: 'boolean' }, debugging: { type: 'boolean' } } },
      decisions: { type: 'object', required: ['behavior', 'contract', 'stableFact', 'pitfall', 'decision'], properties: Object.fromEntries(['behavior', 'contract', 'stableFact', 'pitfall', 'decision'].map(k => [k, { type: 'object', required: ['changed', 'reason'], properties: { changed: { type: 'boolean' }, reason: { type: 'string' }, path: { type: 'string' } } }])) }
    }
  }
};
