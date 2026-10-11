'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
function reporter() {
  const file = process.env.PI_BEHAVIOR_REPORT;
  const runId = process.env.PI_BEHAVIOR_RUN;
  if (!file) return { passed() {}, finish() {} };
  const temp = path.resolve(process.env.PI_SCRATCH_DIR || os.tmpdir());
  if (
    path.dirname(path.resolve(file)) !== temp ||
    !/^behavior-report-[a-f0-9-]{36}\.json$/.test(path.basename(file)) ||
    !/^[a-f0-9-]{36}$/.test(runId || '')
  )
    throw Error('Invalid behavior report destination');
  const rows = [];
  const seen = new Set();
  const write = (completed) =>
    fs.writeFileSync(file, JSON.stringify({ version: 1, runId, completed, cases: rows }), 'utf8');
  // Exclusive creation prevents overwriting a user file or following an existing symlink.
  fs.writeFileSync(file, JSON.stringify({ version: 1, runId, completed: false, cases: [] }), {
    flag: 'wx'
  });
  return {
    passed(id) {
      if (!/^[a-z][a-z0-9-]{0,79}$/.test(id) || seen.has(id))
        throw Error('Duplicate/invalid reported case');
      seen.add(id);
      rows.push({ id, status: 'passed' });
      write(false);
    },
    finish(completed) {
      write(completed === true);
    }
  };
}
module.exports = { reporter };
