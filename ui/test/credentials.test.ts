import {expect,it} from 'vitest';
import type {CredentialWriteRequest} from '../../runtime/src/model-protocol';
import {ApplicationClient} from '../src/client';

it('saves and removes credentials only through the narrow native writer with correlated generation receipts',async()=>{
  const ordinary:string[]=[],credential:CredentialWriteRequest[]=[];
  const client=new ApplicationClient({postMessage:json=>ordinary.push(json),writeCredential:json=>credential.push(JSON.parse(json))});
  const result=client.writeCredential({operation:'save',target:'connection-a',expectedGeneration:3,key:'synthetic-ui-secret'});
  const request=credential[0];
  expect(request).toMatchObject({protocol:1,connectionId:client.connectionId,operation:'save',target:'connection-a',expectedGeneration:3,key:'synthetic-ui-secret'});
  client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value:{connectionId:'connection-a',state:'configured',generation:4,configured:true}});
  await expect(result).resolves.toMatchObject({state:'configured',generation:4});
  const removed=client.writeCredential({operation:'remove',target:'connection-a',expectedGeneration:4});
  const removal=credential[1];expect(removal).not.toHaveProperty('key');
  client.receive({type:'response',protocol:1,connectionId:removal.connectionId,requestId:removal.requestId,ok:true,value:{connectionId:'connection-a',state:'absent',generation:5,configured:false}});
  await expect(removed).resolves.toMatchObject({state:'absent',generation:5});
  expect(ordinary).toEqual([]);client.dispose();
});

it('never falls back to generic messages when a native credential writer is unavailable',async()=>{
  const sent:string[]=[];const client=new ApplicationClient({postMessage:json=>sent.push(json)});
  await expect(client.writeCredential({operation:'save',target:'connection-a',expectedGeneration:0,key:'synthetic-ui-secret'})).rejects.toMatchObject({code:'CREDENTIAL_WRITER_UNAVAILABLE'});
  expect(sent).toEqual([]);client.dispose();
});
