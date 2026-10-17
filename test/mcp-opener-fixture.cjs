'use strict';
// Node --require test fixture only. No production environment switch or actual OS browser.
require('../build/plugin/browser-open').openBrowser = async url => {
  const parsed = new URL(url), token = parsed.hash.slice(1);
  if (!/^[a-f0-9]{64}$/.test(token) || (await fetch(parsed.origin + '/panel/')).status !== 200) throw Error('Fixture browser failed');
  const response = await fetch(parsed.origin + '/api/invoke', { method: 'POST', headers: { Origin: parsed.origin, 'Content-Type': 'application/json', 'X-Governance-Token': token }, body: JSON.stringify({ channel: 'governance.lease', payload: { id: require('node:crypto').randomBytes(16).toString('hex'), event: 'join' } }) });
  if (response.status !== 200) throw Error('Fixture lease failed');
};
