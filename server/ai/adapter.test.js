import test from 'node:test';
import assert from 'node:assert/strict';
import { chatCompletion } from './adapter.js';
import { PRESETS } from '../../shared/presets.js';

test('all presets use fixed destinations and the supported chat-completions parameters', async () => {
 const destinations = {
  gemini:'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  openrouter:'https://openrouter.ai/api/v1/chat/completions',
  openai:'https://api.openai.com/v1/chat/completions',
  anthropic:'https://api.anthropic.com/v1/chat/completions',
 };
 assert.deepEqual(Object.keys(PRESETS),Object.keys(destinations));
 for (const [preset,expected] of Object.entries(destinations)) {
  const signal = new AbortController().signal;
  await chatCompletion({preset,apiKey:'private',model:'chosen-model',messages:[{role:'user',content:'Hello'}],maxCompletionTokens:123,stream:true,signal,top_p:0.5,max_tokens:12},async (url,init)=>{
   assert.equal(url,expected); assert.equal(init.redirect,'error'); assert.equal(init.signal,signal);
   assert.equal(init.headers.Authorization,'Bearer private');
   const body = JSON.parse(init.body);
   assert.deepEqual(body.messages,[{role:'user',content:'Hello'}]);
   assert.equal(body.model,'chosen-model'); assert.equal(body.max_completion_tokens,123); assert.equal(body.stream,true);
   assert.ok(!Object.hasOwn(body,'top_p')); assert.ok(!Object.hasOwn(body,'max_tokens'));
   if(['openai','anthropic'].includes(preset)) assert.ok(!Object.hasOwn(body,'temperature'));
   else assert.equal(body.temperature,0);
   return new Response('{}');
  });
 }
});

test('the removed provider cannot make adapter requests', async () => {
 let calls = 0;
 await assert.rejects(chatCompletion({preset:'groq',apiKey:'fake-key'},async()=>{calls++;return new Response('{}');}),/Unsupported preset/);
 assert.equal(calls,0);
});
