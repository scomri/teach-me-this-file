import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSettings, saveSettings } from './settings.js';
test('keys are memory-only unless remembering this tab, opt-out deletes them', () => {
 const data = new Map(); const storage = {getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 const settings = {preset:'openrouter',apiKey:'tab-secret',evaluator:'',teacher:'',code:'ok',remember:false};
 saveSettings(settings,storage); assert.equal(data.size,0); assert.equal(loadSettings(storage).settings.apiKey,'');
 saveSettings({...settings,remember:true},storage); assert.equal(loadSettings(storage).settings.apiKey,'tab-secret');
 saveSettings(settings,storage); assert.equal(loadSettings(storage).settings.apiKey,'');
});
test('blocked storage and corrupt stored values never crash or restore untrusted settings', () => {
 const blocked = {getItem(){throw Error()},setItem(){throw Error()},removeItem(){throw Error()}};
 assert.equal(loadSettings(blocked).settings.apiKey,''); assert.equal(saveSettings({remember:true},blocked),false);
 for(const value of ['{','null','{"preset":"__proto__","apiKey":"x"}','{"preset":"gemini","apiKey":4}']) assert.equal(loadSettings({getItem:()=>value}).settings.apiKey,'');
});

test('a storage read failure is reported separately from empty settings', () => {
 const blocked = {getItem(){throw new Error('storage denied');}};
 assert.equal(loadSettings(blocked).storageUnavailable,true);
 assert.equal(loadSettings({getItem:()=>null}).storageUnavailable,false);
});

test('a remembered removed provider is not restored', () => {
 const saved = {preset:'groq',apiKey:'old-secret',evaluator:'old-model',teacher:'old-model',remember:true,code:'ok'};
 const {settings} = loadSettings({getItem:()=>JSON.stringify(saved)});
 assert.equal(settings.preset,'gemini');
 assert.equal(settings.apiKey,'');
});
