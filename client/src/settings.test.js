import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSettings, saveSettings } from './settings.js';
test('keys are memory-only unless remembering this tab, opt-out deletes them', () => {
 const data = new Map(); const storage = {getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 const settings = {preset:'groq',apiKey:'tab-secret',evaluator:'',teacher:'',code:'ok',remember:false};
 saveSettings(settings,storage); assert.equal(data.size,0); assert.equal(loadSettings(storage).apiKey,'');
 saveSettings({...settings,remember:true},storage); assert.equal(loadSettings(storage).apiKey,'tab-secret');
 saveSettings(settings,storage); assert.equal(loadSettings(storage).apiKey,'');
});
test('blocked storage and corrupt stored values never crash or restore untrusted settings', () => {
 const blocked = {getItem(){throw Error()},setItem(){throw Error()},removeItem(){throw Error()}};
 assert.equal(loadSettings(blocked).apiKey,''); assert.equal(saveSettings({remember:true},blocked),false);
 for(const value of ['{','null','{"preset":"__proto__","apiKey":"x"}','{"preset":"gemini","apiKey":4}']) assert.equal(loadSettings({getItem:()=>value}).apiKey,'');
});
