import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool, due, classify } from '../src/pool.js';
import { account, writeJSON, readJSON, loadSettings, MINUTE } from '../src/config.js';
import { parseUsage, fetchUsage } from '../src/usage.js';
import { credential } from '../src/credentials.js';
import { catalog, modelConfig, selectedModels } from '../src/catalog.js';
import { createHooks } from '../src/hooks.js';

function usage(now, percent = 0, blocked = false) {
  return Object.fromEntries(['rolling','weekly','monthly'].map(period => [period,
    { percent, status: blocked ? 'rate-limited' : 'ok', resetsAt: new Date(now + 60 * MINUTE).toISOString() }]));
}
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'go-pool-test-'));
  const files = { config: join(root, 'config.json'), data: root, usage: join(root,'usage.json'), state: join(root,'state.json'), lock:join(root,'usage.lock') };
  await writeJSON(files.config, { accounts:['A','B','C'] });
  let now = Date.now(); const calls = [];
  const responses = { A: {usage:usage(now,96)}, B: {usage:usage(now,100,true)}, C: {usage:usage(now)} };
  const dependencies = {files, clock:()=>now, getCredential:async item => `fake-${item.id}`,
    getUsage:async key => { const id=key.slice(-1);calls.push(id);return structuredClone(responses[id]); }};
  const pool = new Pool(dependencies);
  t.after(async () => { pool.stop(); await pool.refreshing; await rm(root,{recursive:true,force:true}); });
  return { pool, files, dependencies, calls, responses, tick:minutes=>{now+=minutes*MINUTE;}, now:()=>now };
}

test('catalog preserves each Go model modality, SDK and reasoning controls', () => {
  assert.equal(Object.keys(catalog.models).length >= 10,true);
  const flash=modelConfig(catalog.models['deepseek-v4.1-flash']);
  assert.deepEqual(flash.modalities.input,['text','image']);
  assert.equal(flash.interleaved.field,'reasoning_content');
  assert.equal(flash.variants.max.reasoningEffort,'max');
  assert.equal(flash.variants.medium.disabled,true);
  assert.equal(modelConfig(catalog.models['minimax-m3']).provider.npm,'@ai-sdk/anthropic');
  assert.equal(modelConfig(catalog.models['gpt-6-luna']).provider.npm,'@ai-sdk/openai');
  for (const definition of Object.values(catalog.models)) {
    const model=modelConfig(definition);
    assert.ok(model.limit.context>0 && model.limit.output>0);
    assert.ok(model.modalities.input.includes('text'));
    assert.equal('structured_output' in model,false,'not an OpenCode v1 config field');
    assert.equal(model.provider.api.startsWith('https://opencode.ai/'),true);
  }
  assert.throws(()=>selectedModels(['not-a-go-model']),/Unknown Go model/);
});

test('configuration supports more than single-letter accounts and rejects invalid metadata', async t => {
  const f=await fixture(t);
  assert.equal(account('team1').env,'OPENCODE_GO_KEY_TEAM1');
  assert.throws(()=>account('../A'),/Account ID/);
  await writeJSON(f.files.config,{accounts:['A','A','TEAM1'],polling:{activeMinutes:0}});
  await assert.rejects(loadSettings(f.files.config),/Polling/);
  await writeJSON(f.files.config,{accounts:['A','A','TEAM1']});
  assert.deepEqual((await loadSettings(f.files.config)).accounts.map(a=>a.id),['A','TEAM1']);
});

test('usage parses only allowlisted numeric fields and suppresses error bodies', async () => {
  const body={usage:usage(Date.now(),97),apiKey:'DO_NOT_PRINT'};
  assert.equal(JSON.stringify(parseUsage(body)).includes('DO_NOT_PRINT'),false);
  body.usage.monthly.percent='DO_NOT_PRINT';
  assert.throws(()=>parseUsage(body));
  let options;
  const result=await fetchUsage('DO_NOT_PRINT',async(url,opts)=>{options=opts;return new Response('DO_NOT_PRINT',{status:401});});
  assert.deepEqual(result,{error:'http-401'});
  assert.equal(options.redirect,'error');
  const oversized=await fetchUsage('fake',async()=>new Response('x'.repeat(256*1024+1)));
  assert.deepEqual(oversized,{error:'invalid-response'});
  const valid=await fetchUsage('fake',async()=>Response.json({usage:usage(Date.now(),4)}));
  assert.equal(valid.usage.monthly.percent,4);
});

test('credentials use environment on all platforms without needing a shell helper', async () => {
  assert.equal(await credential(account('A'),{env:{OPENCODE_GO_KEY_A:'fake'},platform:'linux'}),'fake');
  assert.equal(await credential(account('A'),{env:{},platform:'linux'}),null);
});

test('idle hourly and active ten-minute polls return to idle after activity stops', async t => {
  const f=await fixture(t); await f.pool.refresh();
  assert.deepEqual(f.calls,['A','B','C']);
  await f.pool.used(account('A')); f.tick(11); await f.pool.refresh();
  assert.deepEqual(f.calls,['A','B','C','A']);
  f.tick(10); await f.pool.refresh();
  assert.equal(f.calls.length,4,'inactive after 20 minutes');
  f.tick(40); await f.pool.refresh();
  assert.equal(f.calls.filter(x=>x==='A').length,2,'A hourly interval measured from its last poll');
  assert.equal(f.calls.filter(x=>x==='B').length,2);
  f.tick(11); await f.pool.refresh();
  assert.equal(f.calls.filter(x=>x==='A').length,3);
});

test('healthy low remaining stays; exhausted accounts are skipped for every model', async t => {
  const f=await fixture(t); await f.pool.refresh();
  assert.equal((await f.pool.choose(account('A').providerID,'deepseek-v4.1-flash')).id,'A');
  assert.equal((await f.pool.choose(account('B').providerID,'kimi-k3')).id,'C');
  assert.equal(await f.pool.choose('openai','gpt-6-luna'),null);
  assert.equal(await f.pool.choose(account('A').providerID,'not-a-go-model'),null);
});

test('network failure preserves usage and reset re-enables an account', async t => {
  const f=await fixture(t); await f.pool.refresh();
  f.responses.B={error:'query-failed'}; f.tick(61); await f.pool.refresh();
  assert.equal(f.pool.cache.accounts.B.usage.monthly.percent,100);
  f.responses.B={usage:usage(f.now(),2)}; f.tick(61); await f.pool.refresh();
  assert.equal((await f.pool.choose(account('B').providerID,'kimi-k3')).id,'B');
});

test('known resets prompt a recheck before hourly interval without repeated failure queries', () => {
  const now=Date.now(); const entry={usage:usage(now-61*MINUTE,100,true),lastAttempt:now-2*MINUTE};
  const polling={activeMinutes:10,idleMinutes:60,activeWindowMinutes:20};
  assert.equal(due(entry,0,polling,now),true);
  entry.lastAttempt=now;
  assert.equal(due(entry,0,polling,now),false);
});

test('auth/quota block whole account, transient errors block only failed model', async t => {
  const f=await fixture(t); await f.pool.refresh();
  await f.pool.failed(account('A'),'kimi-k3','rate');
  assert.equal(await f.pool.healthy(account('A'),'kimi-k3'),false);
  assert.equal(await f.pool.healthy(account('A'),'deepseek-v4.1-flash'),true);
  await f.pool.failed(account('A'),'deepseek-v4.1-flash','auth');
  assert.equal(await f.pool.healthy(account('A'),'gpt-6-luna'),false);
  f.tick(61); await f.pool.refresh();
  assert.equal(await f.pool.healthy(account('A'),'gpt-6-luna'),true);
  assert.equal(classify({name:'APIError',data:{statusCode:401}}),'auth');
  assert.equal(classify({message:'weekly limit reached'}),'quota');
  assert.equal(classify({message:'model not found'}),null);
  assert.equal(classify({message:'unclassified error'}),null);
});

test('multiple pools share poll cache and do not lose concurrent cooldown mutations', async t => {
  const f=await fixture(t); const second=new Pool(f.dependencies);
  t.after(()=>second.stop());
  await Promise.all([f.pool.refresh(),second.refresh()]);
  assert.equal(f.calls.length,3);
  await Promise.all([f.pool.failed(account('A'),'kimi-k3','rate'),second.failed(account('C'),'kimi-k3','service')]);
  const state=await readJSON(f.files.state,{});
  assert.equal(state.modelLimits['A/kimi-k3'].kind,'rate');
  assert.equal(state.modelLimits['C/kimi-k3'].kind,'service');
  assert.equal((await readFile(f.files.usage,'utf8')).includes('fake-'),false);
});

test('hooks register distinct SDKs, retain model/variant/attachment and stop repeated account attempts', async t => {
  const f=await fixture(t); f.responses.B={usage:usage(f.now())};
  await f.pool.refresh(); const queued=[]; const toasts=[];
  const client={tui:{showToast:async({body})=>toasts.push(body.message)},session:{
    messages:async()=>({data:[{info:{role:'user',id:'u1',variant:'max',agent:'build'},parts:[
      {type:'text',text:'inspect'},{type:'file',mime:'image/png',url:'data:image/png;base64,FAKE',filename:'screen.png'}]}]}),
    promptAsync:async({body})=>{queued.push(body);return {data:null};},abort:async()=>{},
  }};
  const hooks=await createHooks({client,directory:'/test'},f.pool);
  const cfg={}; await hooks.config(cfg);
  assert.equal(cfg.provider[account('C').providerID].options.apiKey,'fake-C');
  assert.equal(cfg.provider[account('C').providerID].models['minimax-m3'].provider.npm,'@ai-sdk/anthropic');
  const model={providerID:account('A').providerID,modelID:'kimi-k3'};
  const output={message:{model,variant:'max'}};
  await hooks['chat.message']({sessionID:'s',model,agent:'build'},output);
  const fail=async()=>hooks.event({event:{type:'session.error',properties:{sessionID:'s',error:{data:{statusCode:401}}}}});
  await fail(); await fail(); await fail();
  assert.equal(queued.length,2);
  assert.deepEqual(queued.map(b=>b.model.modelID),['kimi-k3','kimi-k3']);
  assert.deepEqual(queued.map(b=>b.model.providerID),[account('B').providerID,account('C').providerID]);
  assert.ok(queued.every(b=>b.variant==='max' && b.parts[1].url==='data:image/png;base64,FAKE'));
  await hooks.tool.go_pool_reset.execute(); await fail(); assert.equal(queued.length,2);
  const outside={message:{model:{providerID:'openai',modelID:'gpt-6-luna'}}};
  await hooks['chat.message']({sessionID:'outside',model:outside.message.model},outside);
  assert.equal(outside.message.model.providerID,'openai');
  const status=await hooks.tool.go_pool_status.execute();
  assert.equal(status.includes('fake-'),false);
  assert.equal(toasts.join(' ').includes('fake-'),false);
  await hooks.event({event:{type:'server.instance.disposed',properties:{directory:'/test'}}});
  assert.equal(f.pool.timer,null);
});
