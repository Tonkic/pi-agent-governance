'use strict';
module.exports = {
  name: 'governance',
  description: 'Repository handoff: read status and README first. Resume the active task, or start an approved followUp with action=start; otherwise wait. init preserves existing files. Default workflow: start, progress as needed, verify, close with knowledge summary. verify requires passed,accepted,evidence,diffReview,files. Context reads are optional and may skip layers with a reason. Legacy gate and advisory route remain optional. Never claim this tool runs tests or globally intercepts tools.',
  risk: 'medium',
  schema: {
    type: 'object', additionalProperties: false, required: ['action'],
    properties: {
      action: { type: 'string', enum: ['init', 'status', 'start', 'progress', 'context', 'route', 'verify', 'gate', 'close'] },
      id: { type: 'string' }, goal: { type: 'string' }, criteria: { type: 'array', items: { type: 'string' } },
      scope: { type: 'array', items: { type: 'string' } }, constraints: { type: 'array', items: { type: 'string' } },
      knowledge: { type: 'string', description: 'For close: required concise summary of usage documentation updates or why none are needed; notes are optional.' },
      current: { type: 'string' }, next: { type: 'array', items: { type: 'string' } }, blocked: { type: 'array', items: { type: 'string' } },
      layer: { type: 'string', enum: ['docs', 'contract', 'notes', 'source'] }, reason: { type: 'string' },
      files: { type: 'array', items: { type: 'string' } }, passed: { type: 'boolean' }, accepted: { type: 'array', items: { type: 'boolean' } },
      evidence: { type: 'string' }, diffReview: { type: 'string' }, delta: { type: 'string' },
      features: { type: 'object', properties: { files: { type: 'integer', minimum: 0 }, modules: { type: 'integer', minimum: 0 }, research: { type: 'boolean' }, architecture: { type: 'boolean' }, interfaceChange: { type: 'boolean' }, unknownCause: { type: 'boolean' }, debugging: { type: 'boolean' } } },
      decisions: { type: 'object', required: ['behavior', 'contract', 'stableFact', 'pitfall', 'decision'], properties: Object.fromEntries(['behavior', 'contract', 'stableFact', 'pitfall', 'decision'].map(k => [k, { type: 'object', required: ['changed', 'reason'], properties: { changed: { type: 'boolean' }, reason: { type: 'string' }, path: { type: 'string' } } }])) }
    }
  }
};
