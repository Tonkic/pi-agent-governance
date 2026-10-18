'use strict';
// Run existing local fixtures without their unrelated whole-workbench wrapper.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
async function main(scope = process.argv[2]) {
  if (scope !== 'reader') throw Error('Unknown local browser scope');
  const { chromium } = require('playwright');
  const screenshots = path.join(process.env.PI_SCREENSHOT_DIR || process.env.PI_SCRATCH_DIR || os.tmpdir(), 'reader-check');
  await fs.mkdir(screenshots, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.PI_BROWSER ? { executablePath: process.env.PI_BROWSER } : {}) });
  try {
    for (const fixture of ['documents-browser.cjs', 'reader-typography-browser.cjs', 'unified-shell-browser.cjs']) await require(path.join(__dirname, '../test', fixture))({ browser, screenshots });
  } finally { await browser.close(); }
}
module.exports = { main };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
