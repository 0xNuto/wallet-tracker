import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('./index.js',import.meta.url),'utf8');
const m=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const A='So11111111111111111111111111111111111111112', B='11111111111111111111111111111111', C='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const trade=(mint,usd,time=1)=>({wallet:A,mint,usd,time,amount:1,hash:'tx',side:'buy'});
test('cumulative threshold and N-of-M use known qualifying buys',()=>{
 const map=new Map();for(let i=0;i<5;i++)m.addSummary(map,trade(A,20));m.addSummary(map,trade(B,100));m.addSummary(map,trade(C,null));
 assert.equal(m.sharedWallets(map,[A,B,C],{minTotalUsd:100}).length,0);
 const matches=m.sharedWallets(map,[A,B,C],{minTokens:2,minTotalUsd:100});assert.deepEqual(matches[0].matchedMints,[A,B]);
 assert.equal(m.sharedWallets(map,[A,B,C]).length,1);
});
test('per-trade minimum precedes aggregate matching and ranges are half-open',()=>{
 const scan={minUsd:25,tokens:[{mint:A,start:10,end:20}]};
 assert.equal(m.qualifies(trade(A,20,10),scan),false);assert.equal(m.qualifies(trade(A,30,10),scan),true);assert.equal(m.qualifies(trade(A,30,20),scan),false);
});
test('invalid overlap and total thresholds rejected',()=>{
 const opts={mints:[A,C],period:'24',end:1700000000};assert.throws(()=>m.makeScan({...opts,minTokens:3}));assert.throws(()=>m.makeScan({...opts,minTokens:1}));assert.throws(()=>m.makeScan({...opts,minTotalUsd:-1}));assert.equal(m.makeScan(opts).minTokens,0);
});
test('repeated pages pause in same window, allowed in distinct windows',()=>{
 const token={pending:[{start:10,end:20,offset:0}]};const page={fingerprint:'x',hasNext:true,rawCount:100};m.checkPageProgress(token,page);assert.throws(()=>m.checkPageProgress(token,page));token.pending[0].end=15;m.checkPageProgress(token,page);assert.throws(()=>m.checkPageProgress(token,{hasNext:true,rawCount:0}));
});
test('busy windows split early with boundary overlap; dense seconds retain pagination',()=>{
 const t={pending:[{start:10,end:100,offset:1900}],covered:0,gaps:[]};m.advanceWindow(t,{hasNext:true,rawCount:100,oldestTime:60});assert.deepEqual(t.pending[0],{start:10,end:61,offset:0});assert.equal(t.covered,39);
 const dense={pending:[{start:10,end:11,offset:1900}],covered:0,gaps:[]};m.advanceWindow(dense,{hasNext:true,rawCount:100,oldestTime:10});assert.equal(dense.pending[0].offset,2000);dense.pending[0].offset=9900;m.advanceWindow(dense,{hasNext:true,rawCount:100,oldestTime:10});assert.equal(dense.gaps.length,1);assert.equal(dense.covered,0);
});
test('normalizer excludes ambiguous swaps and invalid monetary values',()=>{
 const raw={owner:A,tx_hash:'hash',block_unix_time:10,to:{address:C,ui_amount:-1},from:{address:A},volume_usd:-4};assert.equal(m.normalize(raw,C).amount,null);assert.equal(m.normalize(raw,C).usd,null);assert.equal(m.normalize({...raw,from:{address:C}},C),null);
});
test('temporary 502 retries, denied access does not',async()=>{
 let calls=0;const fetch=async()=>++calls===1?Response.json({error:'temporary'},{status:502}):Response.json({items:[]});await m.fetchTradePage({},null,()=>{},fetch,async()=>{});assert.equal(calls,2);
 calls=0;await assert.rejects(m.fetchTradePage({},null,()=>{},async()=>{calls++;return Response.json({error:'denied',retryable:false},{status:502})},async()=>{}));assert.equal(calls,1);
});
test('embedded browser logic equals exported functions and compiles',()=>{
 const a=source.indexOf('const HTML=')+11,b=source.indexOf(';\nexport const');const html=JSON.parse(source.slice(a,b));const script=html.slice(html.indexOf('<script>const EARLIEST')+8,html.indexOf('</script></body>'));new vm.Script(script);
 const shared=source.slice(source.indexOf('export const EARLIEST'),source.indexOf('\nconst json=')).replaceAll('export ','');assert.ok(script.startsWith(shared));assert.ok(html.includes('id="minTotalUsd"'));assert.ok(script.includes('for(const mint of w.matchedMints)'));
});
