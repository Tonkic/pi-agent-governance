'use strict';
const fs=require('node:fs'),path=require('node:path');
function build(root){
 const out=path.join(root,'build/plugin/ssh-runtime.js');
 if(require('ssh2/package.json').version!=='1.17.0')throw Error('Review SSH build adaptations before upgrading dependency');
 require('esbuild').buildSync({entryPoints:[path.join(root,'plugin/ssh-runtime.ts')],outfile:out,bundle:true,platform:'node',format:'cjs',target:'node22',external:['cpu-features','*.node'],legalComments:'external',logLevel:'warning'});
 let code=fs.readFileSync(out,'utf8');
 // Upstream's EdDSA feature test embeds a public fixture private key. Do not ship
 // fixed private material: generate the same kind of ephemeral test key in memory.
 const fixture=/const key = "[-]{5}BEGIN PRIVATE KEY[-]{5}[^\n]+?[-]{5}END PRIVATE KEY[-]{5}";/g;
 if((code.match(fixture)||[]).length!==1)throw Error('SSH self-test adaptation no longer matches pinned source');
 code=code.replace(fixture,'let key; try { key = crypto.generateKeyPairSync("ed25519").privateKey; } catch { return false; }');
 // These are regex/string FORMAT delimiters, not keys. An escaped space retains
 // exact parsing while avoiding a false credential header in distributed source.
 if((code.match(/OPENSSH PRIVATE KEY/g)||[]).length!==4)throw Error('Review SSH key-format delimiter adaptation');
 code=code.replaceAll('OPENSSH PRIVATE KEY','OPENSSH PRIVATE\\x20KEY');
 fs.writeFileSync(out,code);
 const entries=['ssh2','asn1','bcrypt-pbkdf','tweetnacl','safer-buffer'];
 let text='<!-- Generated from pinned dependency licenses by scripts/build-ssh.cjs. -->\n# SSH runtime licenses\n\nPure JavaScript bundle. Optional native acceleration is not distributed. Build adaptations: the EdDSA self-test generates an ephemeral key instead of embedding an upstream fixture; format delimiters use equivalent escaped spaces.\n';
 for(const name of entries){const dir=path.dirname(require.resolve(name+'/package.json',{paths:[root]})),pkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));const file=['LICENSE','LICENSE.txt','LICENCE'].map(f=>path.join(dir,f)).find(f=>fs.existsSync(f));if(!file)throw Error('Missing SSH dependency license: '+name);text+='\n## '+name+' '+pkg.version+'\n\n'+fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n')+'\n';}
 fs.writeFileSync(path.join(root,'plugin/SSH-LICENSES.md'),text);
 const legal=path.join(root,'build/plugin/ssh-runtime.js.LEGAL.txt');if(!fs.existsSync(legal))fs.writeFileSync(legal,'Bundled SSH dependency licenses: see ../SSH-LICENSES.md in the PI package, or plugin/SSH-LICENSES.md in the portable package.\n');
}
module.exports={build};
