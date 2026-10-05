'use strict';
const { Governance } = require('../plugin/core');
async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const result = await new Governance(process.cwd()).run(JSON.parse(input));
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
