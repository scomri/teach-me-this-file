import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.js';
test('check maps provider outcomes without exposing keys or errors', async (t) => {
  for (const [status, code] of [[200,'ok'],[401,'invalid_key'],[403,'invalid_key'],[404,'model_not_found'],[429,'rate_limited'],[500,'unreachable'],[0,'unreachable']]) {
    const lines = []; const calls = [];
    const app = createApp({log: x => lines.push(x), providerFetch: async (...args) => { calls.push(args); if (!status) throw Error('secret-key'); return new Response('secret-key', {status}); }});
    const server = app.listen(0); t.after(() => server.close());
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/check`, {method:'POST', headers:{'Content-Type':'application/json','X-Api-Key':'secret-key'},body:JSON.stringify({preset:'gemini'})});
    const body = await res.json(); assert.equal(body.code, code);
    if (code === 'model_not_found') assert.equal(body.role, 'evaluator');
    assert.ok(!JSON.stringify(body).includes('secret-key')); assert.ok(!lines.join('').includes('secret-key'));
    if (code === 'ok') assert.equal(calls.length, 2);
  }
});

test('check still validates teacher after an evaluator warning', async (t) => {
 let count = 0;
 const app = createApp({log:()=>{}, providerFetch:async()=>new Response('',{status:++count === 1 ? 429 : 404})});
 const server = app.listen(0); t.after(()=>server.close());
 const res = await fetch(`http://127.0.0.1:${server.address().port}/api/check`,{method:'POST',headers:{'Content-Type':'application/json','X-Api-Key':'secret-key'},body:'{"preset":"gemini"}'});
 assert.deepEqual(await res.json(),{code:'model_not_found',role:'teacher'});
});

test('check times out, rejects unsupported input, and uses defaults for blank roles', async (t) => {
 const lines = []; const models = [];
 const app = createApp({log:x=>lines.push(x),checkTimeoutMs:20,providerFetch:async(url,init)=>{
  const model = JSON.parse(init.body).model; models.push(model);
  if (model === 'timeout') return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('secret-key')),{once:true}));
  return new Response('{}');
 }});
 const server = app.listen(0); t.after(()=>server.close());
 async function check(body,key='secret-key') {
  return fetch(`http://127.0.0.1:${server.address().port}/api/check`,{method:'POST',headers:{'Content-Type':'application/json','X-Api-Key':key},body:JSON.stringify(body)});
 }
 assert.deepEqual(await (await check({preset:'gemini',evaluator:'timeout'})).json(),{code:'unreachable'});
 assert.equal((await check({preset:'http://localhost'})).status,400);
 assert.equal((await check({preset:'__proto__'})).status,400);
 assert.equal((await check({preset:'gemini',teacher:{}})).status,400);
 assert.deepEqual(await (await check({preset:'gemini'},'')).json(),{code:'invalid_key'});
 assert.deepEqual(await (await check({preset:'groq',evaluator:' ',teacher:'custom-model'})).json(),{code:'ok'});
 assert.deepEqual(models,['timeout','openai/gpt-oss-20b','custom-model']);
 assert.ok(!lines.join('').includes('secret-key'));
});
