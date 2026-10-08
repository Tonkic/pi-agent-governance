'use strict';
module.exports = {
  name: 'governance',
  description:
    'Repository governance: read status/README and resume approved work. ' +
    'For Git collaboration call git_status first; git_create allocates coordinator/worker branch ' +
    'and worktree before a writing delegate; git_diff supplies review snapshot; ' +
    'git_commit requires expectedDiff; git_verify binds actual test evidence to expectedHead; ' +
    'git_integrate merges a verified worker into its coordinator only. Set delegate cwd explicitly. ' +
    'No auto host spawning, main merge, push, reset or stash. ' +
    'State workflow remains start/progress/verify/close with knowledge summary. ' +
    'Tests and approvals are caller-attested. See plugin README.',
  risk: 'high',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: {
        type: 'string',
        enum: [
          'init',
          'status',
          'start',
          'progress',
          'context',
          'route',
          'verify',
          'gate',
          'close',
          'git_status',
          'git_create',
          'git_diff',
          'git_commit',
          'git_verify',
          'git_integrate',
          'git_recover',
          'project_snapshot',
          'architecture_sources',
          'architecture_set',
          'board_create',
          'board_update',
          'board_move',
          'board_accept'
        ]
      },
      expectedRevision: {
        type: 'string',
        description: 'Revision from project_snapshot; binds workspace, STATE and project data.'
      },
      title: { type: 'string' },
      description: { type: 'string' },
      blocker: { type: 'string' },
      gitTaskId: { type: 'string' },
      stage: { type: 'string', enum: ['todo', 'doing', 'done', 'accepted'] },
      method: { type: 'string', enum: ['human', 'agent'] },
      reviewer: {
        type: 'string',
        description: 'Reviewer label; caller-attested, not identity authentication.'
      },
      conclusion: { type: 'string' },
      expectedItem: {
        type: 'string',
        description:
          'itemFingerprint from project_snapshot; binds acceptance to the reviewed work item.'
      },
      position: { type: 'integer', minimum: 0 },
      graph: {
        type: 'object',
        required: ['title', 'source', 'nodes', 'edges', 'fingerprints'],
        properties: {
          title: { type: 'string' },
          source: {
            type: 'string',
            description: 'Describe the inspected sources and analysis limits.'
          },
          nodes: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id', 'title', 'description', 'files'],
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                description: { type: 'string' },
                files: { type: 'array', items: { type: 'string' } }
              }
            }
          },
          edges: {
            type: 'array',
            items: {
              type: 'object',
              required: ['from', 'to', 'label'],
              properties: {
                from: { type: 'string' },
                to: { type: 'string' },
                label: { type: 'string' }
              }
            }
          },
          fingerprints: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Exact hashes returned by architecture_sources for all referenced files.'
          }
        }
      },
      id: { type: 'string' },
      goal: { type: 'string' },
      criteria: { type: 'array', items: { type: 'string' } },
      owner: {
        type: 'string',
        description: 'Agent/task owner label; not an authenticated identity.'
      },
      role: { type: 'string', enum: ['coordinator', 'worker'] },
      parent: { type: 'string', description: 'Coordinator task id for workers.' },
      allowedPaths: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Exact relative files or directory prefixes ending in /. No globs. Worker scope must fit coordinator scope.'
      },
      expectedHead: {
        type: 'string',
        description: 'Exact reviewed base/current/target commit SHA.'
      },
      expectedDiff: {
        type: 'string',
        description: 'snapshot from git_diff; required by git_commit.'
      },
      source: { type: 'string', description: 'Worker task id to integrate.' },
      sourceHead: { type: 'string', description: 'Exact verified worker SHA.' },
      message: { type: 'string', description: 'Git commit message.' },
      scope: { type: 'array', items: { type: 'string' } },
      constraints: { type: 'array', items: { type: 'string' } },
      knowledge: {
        type: 'string',
        description:
          'For close: required concise summary of usage documentation updates or why none are needed; notes are optional.'
      },
      current: { type: 'string' },
      next: { type: 'array', items: { type: 'string' } },
      blocked: { type: 'array', items: { type: 'string' } },
      layer: { type: 'string', enum: ['docs', 'contract', 'notes', 'source'] },
      reason: { type: 'string' },
      files: { type: 'array', items: { type: 'string' } },
      passed: { type: 'boolean' },
      accepted: { type: 'array', items: { type: 'boolean' } },
      evidence: { type: 'string' },
      diffReview: { type: 'string' },
      delta: { type: 'string' },
      features: {
        type: 'object',
        properties: {
          files: { type: 'integer', minimum: 0 },
          modules: { type: 'integer', minimum: 0 },
          research: { type: 'boolean' },
          architecture: { type: 'boolean' },
          interfaceChange: { type: 'boolean' },
          unknownCause: { type: 'boolean' },
          debugging: { type: 'boolean' }
        }
      },
      decisions: {
        type: 'object',
        required: ['behavior', 'contract', 'stableFact', 'pitfall', 'decision'],
        properties: Object.fromEntries(
          ['behavior', 'contract', 'stableFact', 'pitfall', 'decision'].map((k) => [
            k,
            {
              type: 'object',
              required: ['changed', 'reason'],
              properties: {
                changed: { type: 'boolean' },
                reason: { type: 'string' },
                path: { type: 'string' }
              }
            }
          ])
        )
      }
    }
  }
};
