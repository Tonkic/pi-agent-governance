'use strict';
// Read-only compatibility for existing layout tests outside the release worker's scope.
// Marketplace transport, credentials, payload generation and mutation CLI were removed.
// New callers must use build-distributions.cjs.piFiles directly.
module.exports = { files: require('./build-distributions.cjs').piFiles.filter(file => file !== 'manifest.json') };
if (require.main === module) {
  console.error('Marketplace publisher removed. See docs/releasing.md for GitHub-only major releases.');
  process.exitCode = 1;
}
