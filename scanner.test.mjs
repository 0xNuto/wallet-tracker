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

test('historical mode defaults and early entry boundaries intersect selected dates',()=>{
 const scan=m.makeScan({mints:[A,C],period:'24',end:1700000000});assert.equal(scan.mode,'historical');assert.equal(scan.requireVerified,true);
 const token=scan.tokens[0],birth=token.start+100;m.prepareEarlyWindow(token,birth,1);scan.mode='early';scan.earlyMinutes=1;
 assert.equal(m.qualifies(trade(A,1,birth),scan),true);assert.equal(m.qualifies(trade(A,1,birth+59),scan),true);assert.equal(m.qualifies(trade(A,1,birth+60),scan),false);
 assert.deepEqual(token.pending,[{start:birth,end:birth+60,offset:0}]);assert.throws(()=>m.prepareEarlyWindow(token,null,60));
 const outside={start:1700000000,end:1700000010};m.prepareEarlyWindow(outside,1600000000,60);assert.equal(outside.pending.length,0);
 for(const options of [{mode:'anything'},{minWinRate:101},{minPnl:NaN},{earlyMinutes:0}])assert.throws(()=>m.makeScan({mints:[A,C],period:'24',end:1700000000,...options}));
});
test('owner counts once per token and holder mode requires positive balances and buy evidence',()=>{
 const map=new Map();for(let i=0;i<10;i++)m.addSummary(map,trade(A,5));m.addSummary(map,trade(B,5));m.addSummary(map,{...trade(C,100),side:'sell'});
 const options={minTokens:2,requireVerified:true,walletData:{[A]:{verified:true,balances:{[A]:{held:true},[B]:{held:false},[C]:{held:true}}}}};
 const historical=m.sharedWallets(map,[A,B,C],options);assert.equal(historical.length,1);assert.equal(historical[0].matchedMints.length,2);assert.equal(historical[0].overlapPercent,200/3);
 assert.equal(m.sharedWallets(map,[A,B,C],{...options,mode:'holders'}).length,0);
 options.walletData[A].balances[B].held=true;assert.deepEqual(m.sharedWallets(map,[A,B,C],{...options,mode:'holders'})[0].matchedMints,[A,B]);
 assert.equal(m.sharedWallets(map,[A,B,C],{...options,excludedWallets:[A]}).length,0);
 assert.equal(m.sharedWallets(map,[A,B,C],{...options,walletData:{}}).length,0);
});
test('overlap ranks first, profitability breaks ties, missing metrics fail active filters',()=>{
 const map=new Map();for(const [wallet,mints] of [[A,[A,B,C]],[B,[A,B]],[C,[A,B]]])for(const mint of mints)m.addSummary(map,{...trade(mint,10),wallet});
 const walletData={[A]:{metrics:{pnl:-50,winRate:20}},[B]:{metrics:{pnl:100,winRate:75}},[C]:{metrics:{pnl:null,winRate:null}}};
 const opts={minTokens:2,walletData,ranking:'profit'};assert.deepEqual(m.sharedWallets(map,[A,B,C],opts).map(w=>w.wallet),[A,B,C]);
 assert.deepEqual(m.sharedWallets(map,[A,B,C],{...opts,minPnl:0,minWinRate:50}).map(w=>w.wallet),[B]);
 assert.equal(m.sharedWallets(map,[A,B,C],{...opts,minWinRate:0}).length,2);
});
test('transfer, airdrop and known pool owners are not purchases',()=>{
 const raw={owner:A,tx_hash:'hash',block_unix_time:10,to:{address:C,ui_amount:3},from:{address:A,ui_amount:1},volume_usd:10};
 assert.ok(m.normalize(raw,C));for(const tx_type of ['transfer','airdrop','add_liquidity'])assert.equal(m.normalize({...raw,tx_type},C),null);
 assert.equal(m.normalize({...raw,pool_id:A},C),null);assert.equal(m.normalize({...raw,owner:'bad'},C),null);assert.equal(m.normalize({...raw,from:null},C),null);
});
test('account checks reject programs, pools, off-curve addresses and unknown accounts',async()=>{
 const {generateKeyPairSync}=await import('node:crypto');const key=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).subarray(-32);
 let n=BigInt('0x'+key.toString('hex')),address='';const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';while(n){address=alphabet[Number(n%58n)]+address;n/=58n}for(const b of key){if(b!==0)break;address='1'+address}
 const account={owner:B,executable:false,space:0};assert.equal(m.isOnCurve(address),true);assert.equal(m.classifyAccount(address,account).verified,true);
 for(const bad of [null,{...account,executable:true},{...account,owner:C},{...account,space:165}])assert.equal(m.classifyAccount(address,bad).verified,false);
 // Compressed y = 2 is not a point on ed25519; base58 encoding 02 followed by 31 zero bytes.
 let off=2n<<248n,s='';while(off){s=alphabet[Number(off%58n)]+s;off/=58n}assert.equal(m.isOnCurve(s),false);assert.equal(m.classifyAccount(s,account).verified,false);
});
test('balance parsing uses owner, mint and exact raw amounts across all token accounts',()=>{
 const item=amount=>({account:{data:{parsed:{info:{owner:A,mint:C,tokenAmount:{amount}}}}}});
 assert.equal(m.parseHolding({value:[item('0'),item('1')]},A,C).held,true);assert.equal(m.parseHolding({value:[]},A,C).held,false);
 assert.throws(()=>m.parseHolding({value:[item('1')]},B,C));assert.throws(()=>m.parseHolding({value:[item(null)]},A,C));assert.throws(()=>m.parseHolding({},A,C));
});
test('PnL parsing distinguishes missing, zero and no realized win-rate sample',()=>{
 assert.equal(m.parseMetrics({}).pnl,null);assert.equal(m.parseMetrics({summary:{counts:{total_win:0,total_loss:0}}}).winRate,null);
 const value=m.parseMetrics({summary:{counts:{total_win:3,total_loss:1},pnl:{realized_profit_usd:0}}});assert.equal(value.pnl,0);assert.equal(value.winRate,75);assert.equal(value.incomplete,true);
});
test('cached requests coalesce, reuse successful data and do not cache failures',async()=>{
 const original=globalThis.fetch;let calls=0;try{
  globalThis.fetch=async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,5));return Response.json({success:true,data:{value:7}})};
  const url='https://example.invalid/cache-'+crypto.randomUUID();const responses=await Promise.all([m.cachedFetch(url),m.cachedFetch(url)]);
  assert.equal(calls,1);for(const response of responses)assert.equal((await response.json()).data.value,7);
  await m.cachedFetch(url);assert.equal(calls,1);
  globalThis.fetch=async()=>{calls++;return Response.json({error:'failed'},{status:503})};const bad=url+'-bad';await m.cachedFetch(bad);await m.cachedFetch(bad);assert.equal(calls,3);
 }finally{globalThis.fetch=original}
});
test('worker trade route deduplicatable owner records, pools, version, and server caching',async()=>{
 const original=globalThis.fetch;let calls=0;try{
  globalThis.fetch=async url=>{calls++;assert.equal(new URL(url).searchParams.get('tx_type'),'swap');return Response.json({success:true,data:{has_next:false,items:[{owner:A,pool_id:B,tx_type:'swap',tx_hash:'tx',block_unix_time:1700000001,to:{address:C,ui_amount:2},from:{address:A,ui_amount:1},volume_usd:4}]}})};
  const request=()=>new Request('https://app.test/api/trades',{method:'POST',body:JSON.stringify({mint:C,start:1700000000,end:1700000100,offset:0})});
  const r=await m.default.fetch(request(),{BIRDEYE_API_KEY:'test-only'});const data=await r.json();assert.equal(r.status,200);assert.equal(data.version,5);assert.equal(data.items[0].wallet,A);assert.deepEqual(data.pools,[B]);
  await m.default.fetch(request(),{BIRDEYE_API_KEY:'test-only'});assert.equal(calls,1);
 }finally{globalThis.fetch=original}
});
test('new controls, resume enrichment and existing favicon remain present',async()=>{
 const html=await (await m.default.fetch(new Request('https://app.test/'),{})).text();
 for(const id of ['side','earlyMinutes','minPnl','minWinRate','ranking','loadMetrics','resume','minTokens'])assert.ok(html.includes('id="'+id+'"'));
 assert.ok(html.includes('hasPending(value)||!value.enrichmentDone'));assert.ok(html.includes('overlapPercent.toFixed(1)'));
 const icon=await m.default.fetch(new Request('https://app.test/favicon.svg'),{});assert.equal(icon.status,200);assert.match(icon.headers.get('Content-Type'),/svg/);
});
