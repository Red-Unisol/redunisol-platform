import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createWorker, SOURCE_HOST, SOURCE_PATH, PRIMARY_ORIGIN } from "../src/worker.js";
const SECRET="synthetic-test-webhook-secret-only";
async function signed() {
  const body=new TextEncoder().encode('{"eventName":"verification_completed","fixture":true}');
  const key=await webcrypto.subtle.importKey("raw",new TextEncoder().encode(SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const signature=Buffer.from(await webcrypto.subtle.sign("HMAC",key,body)).toString("hex");
  return new Request("https://"+SOURCE_HOST+SOURCE_PATH,{method:"POST",body,headers:{"x-signature":signature,"content-type":"application/json"}});
}
const context=()=>({waitUntil(){}});
function environment(send) { return {PRIMARY_MODE:"hold",METAMAP_WEBHOOK_SECRET:SECRET,SHADOW_QUEUE:{send}}; }
test("hold acknowledges only after durable queue storage and does not call VPS",async()=>{
  let completed=false, saved;
  const instance=createWorker({cryptoImpl:webcrypto,fetchImpl:()=>{throw Error("source must not be called");},log:()=>{}});
  const response=await instance.fetch(await signed(),environment(async body=>{await Promise.resolve();saved=body;completed=true;}),context());
  assert.equal(response.status,200);assert.equal(completed,true);assert.equal(saved.primary_status,202);
  assert.equal(saved.version,1);assert.equal(response.headers.get("X-Metamap-Cutover"),"hold");
});
test("hold queue failure is never acknowledged",async()=>{
  const instance=createWorker({cryptoImpl:webcrypto,fetchImpl:()=>{throw Error("unexpected origin");},log:()=>{}});
  const response=await instance.fetch(await signed(),environment(async()=>{throw Error("queue unavailable");}),context());
  assert.equal(response.status,503);assert.equal(response.headers.get("Retry-After"),"15");
});
test("hold invalid signatures cannot enter the durable queue",async()=>{
  let sent=false;
  const instance=createWorker({cryptoImpl:webcrypto,log:()=>{}});
  const request=await signed();request.headers.set("x-signature","0".repeat(64));
  assert.equal((await instance.fetch(request,environment(async()=>{sent=true;}),context())).status,401);
  assert.equal(sent,false);
});
test("hold gates client writes while reads still work",async()=>{
  let calls=0;
  const instance=createWorker({fetchImpl:async()=>{calls++;return new Response("read");},log:()=>{}});
  const url="https://"+SOURCE_HOST+"/metamap-platform/api/v1/validations/example/review";
  assert.equal((await instance.fetch(new Request(url,{method:"POST"}),{PRIMARY_MODE:"hold"},context())).status,503);
  assert.equal(calls,0);
  assert.equal((await instance.fetch(new Request(url),{PRIMARY_MODE:"hold"},context())).status,200);
  assert.equal(calls,1);
});
test("dedicated proxy preserves path query auth and binary range responses",async()=>{
  const request=new Request("https://"+SOURCE_HOST+"/metamap-platform/updates/transferencias/2.3.1/transferencias-celesol.exe?x=1",{headers:{Range:"bytes=0-15","X-Client-Id":"fixture","X-Client-Secret":"fixture-secret"}});
  const instance=createWorker({log:()=>{},fetchImpl:async upstream=>{
    assert.equal(new URL(upstream.url).hostname,PRIMARY_ORIGIN);
    assert.equal(new URL(upstream.url).pathname,new URL(request.url).pathname);
    assert.equal(new URL(upstream.url).search,"?x=1");
    assert.equal(upstream.headers.get("Range"),"bytes=0-15");
    assert.equal(upstream.headers.get("X-Client-Secret"),"fixture-secret");
    return new Response(new Uint8Array([0,1,255]),{status:206,headers:{"Content-Range":"bytes 0-2/3"}});
  }});
  const response=await instance.fetch(request,{PRIMARY_MODE:"dedicated"},context());
  assert.equal(response.status,206);assert.equal(response.headers.get("Content-Range"),"bytes 0-2/3");
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[0,1,255]);
  assert.equal(response.headers.get("X-Metamap-Cutover"),"dedicated");
});
test("dedicated routing never moves unrelated Kestra paths",async()=>{
  const request=new Request("https://"+SOURCE_HOST+"/api/v1/executions");
  const response=new Response("unchanged");
  const instance=createWorker({fetchImpl:async upstream=>{assert.equal(upstream,request);return response;},log:()=>{}});
  assert.equal(await instance.fetch(request,{PRIMARY_MODE:"dedicated"},context()),response);
});
test("unknown primary mode fails closed",async()=>{
  const instance=createWorker({fetchImpl:()=>{throw Error("unexpected");},log:()=>{}});
  const response=await instance.fetch(new Request("https://"+SOURCE_HOST+"/metamap-platform/health"),{PRIMARY_MODE:"typo"},context());
  assert.equal(response.status,503);
});
