// Real Chrome module Worker smoke for the host-only control-loop queue.
// Separate from source-compiled guest Wasm and protected public playground.
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readBrowserWorkerFixture,BrowserWorkerFixtureAccessError} from './browser-worker-fixture-path.mjs';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const profile=await mkdtemp(join(tmpdir(),'atto-js-control-chrome-'));
const server=createServer(async(req,res)=>{
  try{
    if(req.method!=='GET'&&req.method!=='HEAD'){
      res.writeHead(405,{Allow:'GET, HEAD'});res.end();return;
    }
    const file=await readBrowserWorkerFixture(root,req.url,{head:req.method==='HEAD'});
    res.writeHead(200,{'Content-Type':file.contentType,
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
      'Content-Security-Policy':"default-src 'none'; script-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self'; base-uri 'none'; object-src 'none'"});
    res.end(file.body);
  }catch(error){
    res.writeHead(error instanceof BrowserWorkerFixtureAccessError?403:
      error?.code==='ENOENT'?404:400);res.end();
  }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const chrome=spawn(process.env.CHROME_BIN||'google-chrome',[
  '--headless=new','--no-sandbox','--disable-dev-shm-usage','--no-first-run',
  '--disable-background-networking','--remote-debugging-port=0',
  '--user-data-dir='+profile,'about:blank'
],{stdio:['ignore','ignore','pipe']});
let chromeError=null,exited=false,ws;
let chromeStderr='';
chrome.stderr.on('data',chunk=>{chromeStderr=(chromeStderr+chunk).slice(-16000);});
chrome.on('exit',()=>{exited=true;});
chrome.on('error',err=>{chromeError=err;exited=true;});
try{
  let port;
  for(let i=0;i<250;i++){
    if(exited)throw Error('Chromium startup failed: '+chromeError+' '+chromeStderr);
    try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break;}catch{}
    await delay(100);
  }
  if(!port)throw Error('Chromium DevTools startup timeout');
  const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  const page=pages.find(p=>p.type==='page');
  if(!page)throw Error('no Chromium page target');
  ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok,fail)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',fail,{once:true});});
  const inflight=new Map();let serial=0;
  ws.addEventListener('message',event=>{
    const message=JSON.parse(event.data),entry=inflight.get(message.id);
    if(entry){inflight.delete(message.id);message.error?entry.reject(Error(JSON.stringify(message.error))):entry.resolve(message.result);}
  });
  const rpc=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++serial;inflight.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));
  });
  await rpc('Page.enable');await rpc('Runtime.enable');
  await rpc('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/tests/browser-worker-control-loop.html'});
  let status='';
  for(let i=0;i<180;i++){
    await delay(100);
    const answer=await rpc('Runtime.evaluate',{expression:"document.querySelector('#result')?.textContent",returnByValue:true});
    status=answer?.result?.value??'';
    if(status.startsWith('PASS_')||status.startsWith('FAIL_'))break;
  }
  console.log('Browser Worker control loop: '+(status||'no result'));
  if(status!=='PASS_BROWSER_CONTROL_LOOP')throw Error('real browser Worker control-loop smoke failed');
}finally{
  ws?.close();chrome.kill('SIGTERM');server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
  if(!exited)await Promise.race([new Promise(r=>chrome.once('exit',r)),delay(1500)]);
  await rm(profile,{recursive:true,force:true,maxRetries:8,retryDelay:250}).catch(()=>{});
}
