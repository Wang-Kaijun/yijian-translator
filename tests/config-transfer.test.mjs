import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig, exportConfig, webdavRequest, validateDavUrl } from '../src/config-transfer.mjs';
import { createProfiles } from '../src/profiles.mjs';
import { modelPriceLabel, validateExternalProvider, PROVIDERS } from '../providers.mjs';
const storage = () => { const map = new Map(); return { map, getItem:k=>map.get(k)??null, setItem:(k,v)=>map.set(k,v), removeItem:k=>map.delete(k) }; };
const sample = () => ({ format:'yijian-config',version:1,sites:[{id:'local',type:'custom',label:'Local',baseUrl:'http://192.168.1.9:8080/v1',model:'a',models:['a','b']}],selections:{global:{siteId:'local',model:'a',useGlobal:false},writing:{siteId:'local',model:'b',useGlobal:true}} });
test('configuration round trip preserves independent models and override; secrets opt in',()=>{
 const p=createProfiles(storage(),'/','modelscope'); const data=sample();data.sites[0].apiKey='secret-test';p.importConfig(data);
 const portable=exportConfig(p);assert.ok(!JSON.stringify(portable).includes('secret-test'));assert.equal(exportConfig(p,true).sites.find(s=>s.id==='local').apiKey,'secret-test');
 const saved=storage(),q=createProfiles(saved,'/','modelscope');q.importConfig(exportConfig(p,true));assert.equal(q.own('writing').model,'b');assert.equal(q.isOverridden('writing'),true);assert.ok(!JSON.stringify([...saved.map.values()]).includes('secret-test'));
 assert.equal(createProfiles(saved,'/','modelscope').own('global').apiKey,'');
});
test('import endpoint change never inherits old secret; same endpoint without key preserves it',()=>{
 const p=createProfiles(storage(),'/','modelscope'),data=sample();data.sites[0].apiKey='old-secret';p.importConfig(data,{remember:true});delete data.sites[0].apiKey;p.importConfig(data);assert.equal(p.sites.read('local').apiKey,'old-secret');
 data.sites[0].baseUrl='http://10.0.0.8/v1';p.importConfig(data);assert.equal(p.sites.read('local').apiKey,'');
});
test('malformed imports and failed persistence cannot partially replace active settings',()=>{
 const saved=storage(),p=createProfiles(saved,'/','modelscope');p.importConfig(sample());const before=JSON.stringify(exportConfig(p));
 const invalid=sample();invalid.sites.push({...invalid.sites[0]});assert.throws(()=>p.importConfig(invalid));assert.equal(JSON.stringify(exportConfig(p)),before);
 const change=sample();change.sites[0].label='changed';change.selections.global.model='b';const set=saved.setItem;saved.setItem=(k,v)=>{if(k.includes('sites:v1'))throw Error('blocked');return set(k,v);};assert.throws(()=>p.importConfig(change));assert.equal(p.sites.read('local').label,'Local');assert.equal(p.own('global').model,'a');assert.equal(createProfiles(saved,'/','modelscope').own('global').model,'a');
 for(const text of ['{}','not json',JSON.stringify({...sample(),version:99}),JSON.stringify({...sample(),selections:{global:{siteId:'missing',model:'a',useGlobal:false}}})])assert.throws(()=>parseConfig(text));
});
test('WebDAV allows local HTTP, blocks public HTTP, URL credentials and redirects',async()=>{
 for(const url of ['http://localhost:8080/config.json','http://192.168.1.9/a.json','https://dav.example.com/a.json'])assert.equal(validateDavUrl(url),url);
 for(const url of ['http://example.com/a.json','http://169.254.169.254/a','https://user:secret@example.com/a','https://example.com/','https://example.com/a?key=secret'])assert.throws(()=>validateDavUrl(url));
 const result=await webdavRequest({url:'http://localhost:8080/config.json',username:'user',password:'test-password'},async(url,options)=>{assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.equal(options.targetAddressSpace,'loopback');assert.match(options.headers.Authorization,/^Basic /);assert.equal(options.body,undefined);return new Response(JSON.stringify(sample()),{headers:{ETag:'"v1"'}});});assert.equal(result.etag,'"v1"');assert.equal(result.config.sites.length,1);
});
test('WebDAV conditional writes handle conflicts, missing files, invalid and oversized data',async()=>{
 const base={url:'https://dav.example.com/a.json'};
 assert.equal((await webdavRequest(base,async()=>new Response(null,{status:404}))).etag,'__missing__');
 await assert.rejects(webdavRequest({...base,method:'PUT',data:sample()},async()=>{throw Error('must not fetch');}),/先读取/);
 await assert.rejects(webdavRequest({...base,method:'PUT',data:sample(),etag:'"v1"'},async(u,o)=>{assert.equal(o.headers['If-Match'],'"v1"');return new Response(null,{status:412});}),/其他设备/);
 await webdavRequest({...base,method:'PUT',data:sample(),etag:'__missing__'},async(u,o)=>{assert.equal(o.headers['If-None-Match'],'*');return new Response(null,{status:201});});
 await assert.rejects(webdavRequest(base,async()=>new Response('bad json')),/JSON/);
 await assert.rejects(webdavRequest(base,async()=>new Response('x'.repeat(1024*1024+1))),/1 MB/);
});
test('pricing labels stay scoped to official providers, HF has credits rather than free models',()=>{
 assert.match(modelPriceLabel('zhipu','glm-4.7-flash'),/免费/);assert.equal(modelPriceLabel('custom','glm-4.7-flash'),'');assert.equal(modelPriceLabel('zai','glm-4.7-flash'),'');assert.match(modelPriceLabel('openrouter','example:free'),/免费/);assert.match(modelPriceLabel('huggingface','any'),/额度/);
 assert.equal(validateExternalProvider({type:'huggingface',...PROVIDERS.huggingface,apiKey:'test'}).baseUrl,'https://router.huggingface.co/v1');
});
