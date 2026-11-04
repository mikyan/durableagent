import {afterEach,expect,it,vi} from 'vitest';
import {ApplicationClient} from '../src/client';
import {DraftCoordinator} from '../src/drafts';
import {InputPlatform} from './input-platform';
import type {ApplicationRequest} from '../../runtime/src/application-protocol';

afterEach(()=>vi.useRealTimers());
const summary={id:'one',title:'草稿会话',model:{provider:'fixture',modelId:'one',name:'模型'}};

it('an evolving selection receipt adopts concurrently committed text when the UI has no newer edit',async()=>{
  const before={id:'one',revision:0,stateVersion:0,text:'original',selections:[],committed:true};
  const after={...before,revision:2,stateVersion:3,text:'另一界面已提交的正文 🌍',selections:[{id:'selected',source:{name:'x',mimeType:'text/plain',access:'unavailable'},preparation:{state:'failed'}}]};
  let release:undefined|(()=>void);
  const client=new ApplicationClient({postMessage:encoded=>{const r=JSON.parse(encoded);const respond=(value:unknown)=>client.receive({type:'response',protocol:1,connectionId:r.connectionId,requestId:r.requestId,ok:true,value});if(r.method==='input.read')respond(before);else if(r.method==='input.select')release=()=>respond(after);else throw Error('unexpected request');}});
  const drafts=new DraftCoordinator(()=>client,()=>{});
  try{await drafts.read('one');const selection=drafts.select('one','file');while(!release)await Promise.resolve();release();await selection;expect(drafts.view('one')).toMatchObject({status:'saved',revision:2,text:after.text});}
  finally{drafts.dispose();client.dispose();}
});

for(const remove of [false,true])it(`a committed pending selection releases text saves and ${remove?'does not prepare after removal':'prepares after source verification'}`,async()=>{
  vi.useFakeTimers();const platform=new InputPlatform();platform.rememberConversation(summary);let preparations=0;
  const client=new ApplicationClient({postMessage:encoded=>{const r:ApplicationRequest=JSON.parse(encoded);
    if(r.method==='input.select'){
      const value={...platform.read('one'),revision:1,stateVersion:1,selections:[{id:'slow-source',operationId:String(r.payload?.operationId),source:{name:'附件',mimeType:'application/octet-stream',access:'unknown' as const},preparation:{state:'preparing' as const}}]};platform.drafts.set('one',value);
      client.receive({type:'response',protocol:1,connectionId:r.connectionId,requestId:r.requestId,ok:true,value});
    }else if(r.method==='input.prepare'){
      preparations++;const previous=platform.read('one');const value={...previous,stateVersion:previous.stateVersion+1,selections:previous.selections.map(item=>({...item,preparation:{state:'ready' as const,representation:{objectId:'fixed',kind:'text' as const,mimeType:'text/plain',range:'full' as const,sha256:'a'.repeat(64),byteLength:4,capabilityVersion:'v1'}}}))};platform.drafts.set('one',value);
      client.receive({type:'response',protocol:1,connectionId:r.connectionId,requestId:r.requestId,ok:true,value});
    }else void platform.handle(r).then(value=>client.receive(value));
  }});
  const drafts=new DraftCoordinator(()=>client,()=>{});
  try{
    await drafts.read('one');await drafts.select('one','file');expect(drafts.view('one')?.busy).toBe(false);
    drafts.edit('one','来源仍在读取期间的已确认文字');await vi.advanceTimersByTimeAsync(250);expect(platform.read('one').text).toBe('来源仍在读取期间的已确认文字');
    if(remove){drafts.remove('one','slow-source');await drafts.flush('one');}
    const current=platform.read('one');platform.drafts.set('one',{...current,stateVersion:current.stateVersion+1,selections:current.selections.map(item=>({...item,source:{...item.source,mimeType:'text/plain',access:'available'},preparation:{state:'selected'}}))});
    await vi.advanceTimersByTimeAsync(1000);expect(preparations).toBe(remove?0:1);
    expect(drafts.view('one')?.text).toBe('来源仍在读取期间的已确认文字');
    if(remove)expect(drafts.view('one')?.selections).toHaveLength(0);else expect(drafts.view('one')?.selections[0].preparation.state).toBe('ready');
  }finally{drafts.dispose();client.dispose();}
});

it('observes durable preparation before its response and follows a late ready result after the request times out',async()=>{
  vi.useFakeTimers();const platform=new InputPlatform();platform.rememberConversation(summary);
  const selection={id:'slow-picture',source:{name:'慢来源.png',mimeType:'image/png',access:'unavailable' as const},preparation:{state:'selected' as const}};
  platform.drafts.set('one',{id:'one',revision:1,stateVersion:1,text:'',selections:[selection],committed:true});
  const requests:ApplicationRequest[]=[];
  const client=new ApplicationClient({postMessage:encoded=>{
    const request:ApplicationRequest=JSON.parse(encoded);requests.push(request);
    if(request.method==='input.prepare'){
      platform.drafts.set('one',{...platform.read('one'),stateVersion:2,selections:[{...selection,preparation:{state:'preparing'}}]});return;
    }
    void platform.handle(request).then(response=>client.receive(response));
  }});
  const drafts=new DraftCoordinator(()=>client,()=>{});
  try{
    await drafts.read('one');const pending=drafts.prepare('one',selection.id);
    expect(drafts.view('one')?.preparingIds).toEqual([selection.id]);
    expect(drafts.view('one')?.selections[0].preparation.state).toBe('selected');
    await vi.advanceTimersByTimeAsync(500);
    expect(drafts.view('one')?.selections[0].preparation.state).toBe('preparing');
    drafts.edit('one','慢转换时继续编辑');await drafts.flush('one');
    expect(platform.read('one').text).toBe('慢转换时继续编辑');
    await vi.advanceTimersByTimeAsync(20000);await pending;
    expect(drafts.view('one')?.preparingIds).toEqual([]);expect(drafts.view('one')?.observingIds).toEqual([selection.id]);
    expect(drafts.view('one')?.status).toBe('saved');
    platform.drafts.set('one',{...platform.read('one'),stateVersion:4,selections:[{...selection,preparation:{state:'ready',representation:{objectId:'ready-later',kind:'image',mimeType:'image/png',range:'full',sha256:'a'.repeat(64),byteLength:80,capabilityVersion:'v1',width:1,height:1}}}]});
    await vi.advanceTimersByTimeAsync(500);
    expect(drafts.view('one')?.selections[0]).toMatchObject({source:{access:'unavailable'},preparation:{state:'ready'}});
    expect(drafts.view('one')?.observingIds).toEqual([]);expect(drafts.view('one')?.preparationErrors[selection.id]).toBeUndefined();
    expect(requests.filter(request=>request.method==='input.read')).toHaveLength(1);
    const inspected=requests.filter(request=>request.method==='input.inspect').length;
    await vi.advanceTimersByTimeAsync(100000);expect(requests.filter(request=>request.method==='input.inspect')).toHaveLength(inspected);
    expect(requests.filter(request=>request.method==='input.prepare')).toHaveLength(1);
  }finally{drafts.dispose();client.dispose();}
});

it.each(['deadline','unavailable'] as const)('bounds preparation observation when %s is reached and leaves explicit source refresh available',async mode=>{
  vi.useFakeTimers();const platform=new InputPlatform();platform.rememberConversation(summary);
  const selection={id:'bounded',source:{name:'bounded.txt',mimeType:'text/plain',access:'unknown' as const},preparation:{state:'preparing' as const}};
  platform.drafts.set('one',{id:'one',revision:1,stateVersion:1,text:'',selections:[selection],committed:true});
  const requests:ApplicationRequest[]=[];
  const client=new ApplicationClient({postMessage:encoded=>{
    const request:ApplicationRequest=JSON.parse(encoded);requests.push(request);
    if(request.method==='input.inspect'&&mode==='unavailable')return;
    void platform.handle(request).then(response=>client.receive(response));
  }});
  const drafts=new DraftCoordinator(()=>client,()=>{});
  try{
    await drafts.read('one');await vi.advanceTimersByTimeAsync(95000);
    const inspected=requests.filter(request=>request.method==='input.inspect').length;
    expect(inspected).toBeGreaterThan(0);expect(inspected).toBeLessThanOrEqual(mode==='unavailable'?3:180);
    expect(drafts.view('one')?.observingIds).toEqual([]);expect(drafts.view('one')?.preparationErrors.bounded).toContain('手动刷新');
    await vi.advanceTimersByTimeAsync(100000);expect(requests.filter(request=>request.method==='input.inspect')).toHaveLength(inspected);
    platform.drafts.set('one',{...platform.read('one'),stateVersion:2,selections:[{...selection,source:{...selection.source,access:'available'},preparation:{state:'ready',representation:{objectId:'bounded-text',kind:'text',mimeType:'text/plain',range:'full',sha256:'b'.repeat(64),byteLength:5,capabilityVersion:'v1'}}}]});
    await drafts.read('one');expect(drafts.view('one')?.selections[0]).toMatchObject({source:{access:'available'},preparation:{state:'ready'}});expect(drafts.view('one')?.preparationErrors.bounded).toBeUndefined();
    expect(requests.filter(request=>request.method==='input.read')).toHaveLength(2);
  }finally{drafts.dispose();client.dispose();}
});

it('an explicit picker cancellation permits a fresh operation of a different kind',async()=>{
  const platform=new InputPlatform();platform.rememberConversation(summary);const picks:ApplicationRequest[]=[];
  const client=new ApplicationClient({postMessage:encoded=>{const r:ApplicationRequest=JSON.parse(encoded);if(r.method==='input.select'){picks.push(r);client.receive({type:'response',protocol:1,connectionId:r.connectionId,requestId:r.requestId,ok:false,error:{code:'INPUT_PICKER_CANCELLED',message:'已取消选择'}});}else void platform.handle(r).then(value=>client.receive(value));}});
  const drafts=new DraftCoordinator(()=>client,()=>{});
  try{await drafts.read('one');await expect(drafts.select('one','file')).rejects.toMatchObject({code:'INPUT_PICKER_CANCELLED'});await expect(drafts.select('one','image')).rejects.toMatchObject({code:'INPUT_PICKER_CANCELLED'});expect(picks[1].payload?.kind).toBe('image');expect(picks[1].payload?.operationId).not.toBe(picks[0].payload?.operationId);}
  finally{drafts.dispose();client.dispose();}
});

it('automatically saves edits made while a cancelled picker held the draft',async()=>{
  vi.useFakeTimers();const platform=new InputPlatform();platform.rememberConversation(summary);
  let cancel:(()=>void)|undefined;const requests:ApplicationRequest[]=[];
  const client=new ApplicationClient({postMessage:encoded=>{
    const request:ApplicationRequest=JSON.parse(encoded);requests.push(request);
    if(request.method==='input.select')cancel=()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:false,error:{code:'INPUT_PICKER_CANCELLED',message:'已取消选择'}});
    else void platform.handle(request).then(value=>client.receive(value));
  }});
  const drafts=new DraftCoordinator(()=>client,()=>{}),reopened=new DraftCoordinator(()=>client,()=>{});
  try{
    await drafts.read('one');drafts.edit('one','已保存的原草稿');await drafts.flush('one');
    const selection=drafts.select('one','camera');const cancelled=expect(selection).rejects.toMatchObject({code:'INPUT_PICKER_CANCELLED'});
    while(!cancel)await Promise.resolve();
    drafts.edit('one','选择器打开期间继续编辑的草稿 🌍');await vi.advanceTimersByTimeAsync(1100);
    expect(drafts.view('one')).toMatchObject({status:'pending',busy:true});
    expect(platform.read('one').text).toBe('已保存的原草稿');
    cancel();await cancelled;await vi.advanceTimersByTimeAsync(2000);
    expect(drafts.view('one')).toMatchObject({status:'saved',busy:false,error:undefined,text:'选择器打开期间继续编辑的草稿 🌍',selections:[]});
    expect(await reopened.read('one')).toMatchObject({status:'saved',text:'选择器打开期间继续编辑的草稿 🌍',selections:[]});
    expect(requests.some(request=>request.method==='send'||request.method==='input.createSend')).toBe(false);
  }finally{drafts.dispose();reopened.dispose();client.dispose();}
});

it('a confirmed selection operation found by read resolves a lost picker receipt before another explicit selection',async()=>{
  const platform=new InputPlatform();platform.rememberConversation(summary);const picks:ApplicationRequest[]=[];
  const client=new ApplicationClient({postMessage:encoded=>{const r:ApplicationRequest=JSON.parse(encoded);if(r.method==='input.select'){
    picks.push(r);
    if(picks.length===1){platform.drafts.set('one',{...platform.read('one'),revision:1,stateVersion:1,selections:[{id:'selected',operationId:String(r.payload?.operationId),source:{name:'selected.txt',mimeType:'text/plain',access:'available'},preparation:{state:'selected'}}]});}
    client.receive({type:'response',protocol:1,connectionId:r.connectionId,requestId:r.requestId,ok:false,error:{code:picks.length===1?'RESPONSE_TIMEOUT':'INPUT_PICKER_CANCELLED',message:'synthetic lost receipt'}});
  }else void platform.handle(r).then(value=>client.receive(value));}});
  const drafts=new DraftCoordinator(()=>client,()=>{});
  try{await drafts.read('one');await expect(drafts.select('one','file')).rejects.toMatchObject({code:'RESPONSE_TIMEOUT'});await drafts.read('one');await expect(drafts.select('one','image')).rejects.toMatchObject({code:'INPUT_PICKER_CANCELLED'});expect(picks[1].payload?.operationId).not.toBe(picks[0].payload?.operationId);expect(picks[1].payload?.kind).toBe('image');expect(picks[1].payload?.expectedRevision).toBe(1);}
  finally{drafts.dispose();client.dispose();}
});
function setup(){
  const platform=new InputPlatform();platform.rememberConversation(summary);
  const held:{request:ApplicationRequest;release:()=>Promise<void>}[]=[];let hold=false;
  const client=new ApplicationClient({postMessage:json=>{const request:ApplicationRequest=JSON.parse(json);const release=async()=>client.receive(await platform.handle(request));if(hold&&request.method==='input.save')held.push({request,release});else void release();}});
  const drafts=new DraftCoordinator(()=>client,()=>{});
  return {platform,client,drafts,held,hold:()=>{hold=true;},dispose:()=>{drafts.dispose();client.dispose();}};
}
it('keeps edited text pending until native commit and coalesces edits behind one save',async()=>{
  vi.useFakeTimers();const f=setup();
  try{
    await f.drafts.read('one');f.hold();f.drafts.edit('one','第一版');
    await vi.advanceTimersByTimeAsync(249);expect(f.held).toHaveLength(0);expect(f.drafts.view('one')?.status).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);expect(f.held).toHaveLength(1);
    f.drafts.edit('one','新版本');await vi.advanceTimersByTimeAsync(1000);expect(f.held).toHaveLength(1);
    await f.held[0].release();await Promise.resolve();
    expect(f.drafts.view('one')?.text).toBe('新版本');expect(f.drafts.view('one')?.status).toBe('pending');
    const flushed=f.drafts.flush('one');await Promise.resolve();expect(f.held).toHaveLength(2);
    await f.held[1].release();await flushed;
    expect(f.drafts.view('one')).toMatchObject({text:'新版本',revision:2,status:'saved'});
    expect(f.platform.read('one').text).toBe('新版本');
  }finally{f.dispose();}
});

it('saves during continuous input within one second and preserves a new ABA edit after send acceptance',async()=>{
  vi.useFakeTimers();const f=setup();
  try{
    await f.drafts.read('one');f.drafts.edit('one','原输入');
    for(let i=0;i<4;i++){await vi.advanceTimersByTimeAsync(200);f.drafts.edit('one',`连续${i}`);}
    await vi.advanceTimersByTimeAsync(200);expect(f.platform.read('one').text).toBe('连续3');
    f.drafts.edit('one','发送版本');const captured=await f.drafts.freeze('one');
    f.drafts.edit('one','新内容');f.drafts.edit('one','发送版本');
    await f.drafts.accepted('one',captured.frozen.revision,captured.editEpoch);
    expect(f.drafts.view('one')?.text).toBe('发送版本');await f.drafts.flush('one');
    expect(f.platform.read('one').text).toBe('发送版本');
    expect(f.platform.requests.filter(request=>request.method==='input.clear')).toHaveLength(0);
  }finally{f.dispose();}
});

it('shows a revision conflict without discarding local content and offers explicit recovery',async()=>{
  const f=setup();try{
    await f.drafts.read('one');f.drafts.edit('one','本地尚未确认');
    f.platform.drafts.set('one',{...f.platform.read('one'),revision:1,stateVersion:1,text:'其他界面已保存'});
    await expect(f.drafts.flush('one')).rejects.toThrow();
    expect(f.drafts.view('one')).toMatchObject({text:'本地尚未确认',status:'conflict'});
    await f.drafts.recover('one',true);expect(f.platform.read('one').text).toBe('本地尚未确认');
    f.drafts.edit('one','另一个未保存编辑');await f.drafts.recover('one',false);
    expect(f.drafts.view('one')).toMatchObject({text:'本地尚未确认',status:'saved'});
  }finally{f.dispose();}
});

it('rejects stale preparation receipts and keeps ready material even when source access is lost',async()=>{
  const platform=new InputPlatform();platform.rememberConversation(summary);
  const selection={id:'picture',source:{name:'图.png',mimeType:'image/png',access:'available' as const},preparation:{state:'selected' as const}};
  platform.drafts.set('one',{id:'one',revision:1,stateVersion:1,text:'',selections:[selection],committed:true});
  let release!:()=>void;
  const client=new ApplicationClient({postMessage:json=>{const request:ApplicationRequest=JSON.parse(json);if(request.method==='input.prepare'){
    release=()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value:{...platform.read('one'),stateVersion:2,selections:[{...selection,preparation:{state:'preparing'}}]}});
  }else void platform.handle(request).then(response=>client.receive(response));}});
  const drafts=new DraftCoordinator(()=>client,()=>{});
  try{
    await drafts.read('one');const preparing=drafts.prepare('one','picture');
    await expect(drafts.freeze('one')).rejects.toThrow('附件尚未准备完成');
    platform.drafts.set('one',{...platform.read('one'),stateVersion:3,selections:[{...selection,source:{...selection.source,access:'unavailable'},preparation:{state:'ready',representation:{objectId:'fixed',kind:'image',mimeType:'image/png',range:'full',sha256:'a'.repeat(64),byteLength:80,capabilityVersion:'v1',width:1,height:1}}}]});
    await drafts.read('one');release();await preparing;
    expect(drafts.view('one')?.selections[0]).toMatchObject({source:{access:'unavailable'},preparation:{state:'ready'}});
    expect(drafts.view('one')?.stateVersion).toBe(3);expect(platform.requests.some(request=>request.method==='send')).toBe(false);
  }finally{drafts.dispose();client.dispose();}
});

it('retries a lost save receipt with the same operation and cannot clear edits made while a clear is in flight',async()=>{
  vi.useFakeTimers();const platform=new InputPlatform();platform.rememberConversation(summary);
  let lost=true;let clearReceipt:undefined|(()=>void);
  const client=new ApplicationClient({postMessage:json=>{
    const request:ApplicationRequest=JSON.parse(json);
    void platform.handle(request).then(response=>{
      if(request.method==='input.save'&&lost){lost=false;return;}
      if(request.method==='input.clear'){clearReceipt=()=>client.receive(response);return;}
      client.receive(response);
    });
  }},50);
  const drafts=new DraftCoordinator(()=>client,()=>{});
  try{
    await drafts.read('one');drafts.edit('one','已提交但回执丢失');
    const first=drafts.flush('one');const rejected=expect(first).rejects.toMatchObject({code:'RESPONSE_TIMEOUT'});await vi.advanceTimersByTimeAsync(51);await rejected;
    expect(drafts.view('one')).toMatchObject({status:'failed',text:'已提交但回执丢失'});
    await drafts.flush('one');expect(platform.read('one').revision).toBe(1);
    const attempts=platform.requests.filter(request=>request.method==='input.save');expect(attempts).toHaveLength(2);expect(attempts[0].payload).toEqual(attempts[1].payload);
    const captured=await drafts.freeze('one'),clearing=drafts.accepted('one',captured.frozen.revision,captured.editEpoch);
    await Promise.resolve();drafts.edit('one','新文字');drafts.edit('one','已提交但回执丢失');
    clearReceipt!();await clearing;await drafts.flush('one');
    expect(drafts.view('one')).toMatchObject({status:'saved',text:'已提交但回执丢失'});expect(platform.read('one').text).toBe('已提交但回执丢失');expect(platform.read('one').revision).toBe(3);
  }finally{drafts.dispose();client.dispose();}
});

it('keeps the picker operation identity after a missing receipt and does not open another picker automatically',async()=>{
  vi.useFakeTimers();const platform=new InputPlatform();platform.rememberConversation(summary);
  const requests:ApplicationRequest[]=[];let lose=true;
  const client=new ApplicationClient({postMessage:json=>{const request:ApplicationRequest=JSON.parse(json);requests.push(request);if(request.method==='input.select'){
    if(lose){lose=false;return;}
    queueMicrotask(()=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value:platform.read('one')}));
  }else void platform.handle(request).then(response=>client.receive(response));}});
  const drafts=new DraftCoordinator(()=>client,()=>{});
  try{
    await drafts.read('one');const first=drafts.select('one','image'),failed=expect(first).rejects.toMatchObject({code:'RESPONSE_TIMEOUT'});
    await vi.advanceTimersByTimeAsync(180001);await failed;
    expect(requests.filter(request=>request.method==='input.select')).toHaveLength(1);
    await drafts.select('one','image');const picks=requests.filter(request=>request.method==='input.select');
    expect(picks).toHaveLength(2);expect(picks[0].payload).toEqual(picks[1].payload);
    expect(drafts.view('one')?.status).toBe('saved');
  }finally{drafts.dispose();client.dispose();}
});

it('freezes the explicit-send edit barrier while later typing remains an independent unsent draft',async()=>{
  const platform=new InputPlatform();platform.rememberConversation(summary);let release!:()=>void,first=true;
  const client=new ApplicationClient({postMessage:json=>{const request:ApplicationRequest=JSON.parse(json);const reply=()=>void platform.handle(request).then(response=>client.receive(response));if(request.method==='input.save'&&first){first=false;release=reply;}else reply();}});
  const drafts=new DraftCoordinator(()=>client,()=>{});
  try{
    await drafts.read('one');drafts.edit('one','点击发送时的内容');const freezing=drafts.freeze('one');
    drafts.edit('one','发送期间另写的新草稿');release();const captured=await freezing;
    expect(captured.frozen.text).toBe('点击发送时的内容');
    await drafts.accepted('one',captured.frozen.revision,captured.editEpoch);await drafts.flush('one');
    expect(platform.read('one').text).toBe('发送期间另写的新草稿');expect(platform.frozen.get(captured.frozen.token)?.text).toBe('点击发送时的内容');
  }finally{drafts.dispose();client.dispose();}
});

it('retains over-budget pasted text with an explicit error and resumes saving only after the user shortens it',async()=>{
  const f=setup();try{
    await f.drafts.read('one');const text='界'.repeat(100001);f.drafts.edit('one',text);
    expect(f.drafts.view('one')?.status).toBe('failed');expect(f.drafts.view('one')?.text===text).toBe(true);expect(f.drafts.view('one')?.error).toContain('100000');
    await expect(f.drafts.freeze('one')).rejects.toThrow();expect(f.platform.read('one').text).toBe('');
    f.drafts.edit('one','主动缩短');await f.drafts.flush('one');expect(f.platform.read('one').text).toBe('主动缩短');
  }finally{f.dispose();}
});

it('does not replace new edits with a delayed explicit recovery read',async()=>{
  const platform=new InputPlatform();platform.rememberConversation(summary);let hold=false,release!:()=>void;
  const client=new ApplicationClient({postMessage:json=>{const request:ApplicationRequest=JSON.parse(json);const reply=()=>void platform.handle(request).then(response=>client.receive(response));if(hold&&request.method==='input.read')release=reply;else reply();}});
  const drafts=new DraftCoordinator(()=>client,()=>{});
  try{
    await drafts.read('one');drafts.edit('one','原来的未保存编辑');hold=true;
    const recovering=drafts.recover('one',false);drafts.edit('one','恢复请求之后的新输入');release();await recovering;
    expect(drafts.view('one')?.text).toBe('恢复请求之后的新输入');await drafts.flush('one');expect(platform.read('one').text).toBe('恢复请求之后的新输入');
  }finally{drafts.dispose();client.dispose();}
});
