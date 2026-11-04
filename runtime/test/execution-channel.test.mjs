import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeExecutionChannel,ExecutionChannelError} from '../dist/execution-channel.js';

test('native operation is begun once and awaited without blocking the Node owner',async()=>{
  let begins=0,polls=0,ownerTurn=false;
  const channel=new NativeExecutionChannel({
    beginJson(method,payload){begins++;assert.equal(method,'start');assert.deepEqual(JSON.parse(payload),{executionId:'stable-one'});return JSON.stringify({ok:true,value:{operationId:'native-one'}});},
    pollJson(id){assert.equal(id,'native-one');polls++;return JSON.stringify({ok:true,value:polls===1?{pending:true}:{pending:false,result:{ok:true,value:{executionId:'stable-one',state:'running'}}}});},
  });
  setTimeout(()=>{ownerTurn=true;},0);
  const value=await channel.request('start',{executionId:'stable-one'});
  assert.equal(ownerTurn,true);assert.equal(begins,1);assert.equal(polls,2);assert.equal(value.state,'running');
});

test('malformed nested native envelopes never become execution receipts',async()=>{
  const validBegin={ok:true,value:{operationId:'native-one'}};
  const validPoll={ok:true,value:{pending:false,result:{ok:true,value:{state:'running'}}}};
  const cases=[
    [{ok:'true',value:{operationId:'native-one'}},validPoll],
    [{ok:true,value:{operationId:123}},validPoll],
    [validBegin,{ok:true,value:{pending:'false',result:{ok:true,value:{}}}}],
    [validBegin,{ok:true,value:{pending:false,result:{ok:true,value:[]}}}],
    [validBegin,{ok:true,value:{pending:true,result:{ok:true,value:{}}}}],
    [validBegin,{ok:true,value:{pending:false,result:{ok:false,error:{code:'secret material',message:'raw secret'}}}}],
  ];
  for(const [begin,poll]of cases){
    let begins=0;
    const channel=new NativeExecutionChannel({beginJson(){begins++;return JSON.stringify(begin);},pollJson(){return JSON.stringify(poll);}});
    await assert.rejects(channel.request('prepare',{}),error=>error instanceof ExecutionChannelError&&error.code==='NATIVE_PROTOCOL_MISMATCH');
    assert.equal(begins,1);
  }
});

test('ambiguous prepare start and cancel outcomes never trigger a second mutation',async()=>{
  for(const method of ['prepare','start','cancel']){
    let begins=0;
    const channel=new NativeExecutionChannel({beginJson(){begins++;return JSON.stringify({ok:true,value:{operationId:'native-one'}});},pollJson(){return JSON.stringify({ok:true,value:{pending:false,result:{ok:false,error:{code:'CONNECTION_UNCONFIRMED',message:'untrusted raw detail'}}}});}});
    await assert.rejects(channel.request(method,{}),error=>error.code==='CONNECTION_UNCONFIRMED'&&!error.message.includes('raw detail'));
    assert.equal(begins,1);
  }
});

test('non-JSON payload and oversized input do not cross the native boundary',async()=>{
  let begins=0;
  const channel=new NativeExecutionChannel({beginJson(){begins++;throw Error('must not be called');},pollJson(){throw Error('must not be called');}});
  for(const payload of [[],null,{value:Infinity},{value:'x'.repeat(60001)}]){
    await assert.rejects(channel.request('prepare',payload),error=>error.code==='INVALID_EXECUTION_REQUEST');
  }
  assert.equal(begins,0);
});

test('caller deadline reports unknown without resubmitting or issuing remote cancellation',{timeout:16000},async()=>{
  const methods=[];let polls=0;
  const channel=new NativeExecutionChannel({beginJson(method){methods.push(method);return JSON.stringify({ok:true,value:{operationId:'pending-one'}});},pollJson(){polls++;return JSON.stringify({ok:true,value:{pending:true}});}});
  await assert.rejects(channel.request('start',{executionId:'stable-one'}),error=>error.code==='EXECUTION_WAIT_UNKNOWN');
  assert.deepEqual(methods,['start']);assert.ok(polls>1);
});
