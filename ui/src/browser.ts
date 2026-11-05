import type {ApplicationEnvelope} from '../../runtime/src/application-protocol';
import {ApplicationClient,type NativePort} from './client';
import {ConversationController} from './controller';

export interface BrowserHost {
  DurableNative?:NativePort;
  __durableReceive?:(envelope:unknown)=>void;
  __durableOpenConversation?:(id:unknown)=>boolean;
  localStorage:Pick<Storage,'getItem'|'setItem'>;
}
declare global {interface Window {DurableNative?:NativePort;__durableReceive?:(envelope:unknown)=>void;__durableOpenConversation?:(id:unknown)=>boolean}}

const object=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
function envelope(value:unknown):ApplicationEnvelope|undefined {
  if(typeof value==='string'){try{value=JSON.parse(value);}catch{return;}}
  if(!object(value)||typeof value.connectionId!=='string'||!value.connectionId||typeof value.protocol!=='number')return;
  if(value.type==='subscription-error'&&value.protocol===1&&typeof value.subscriptionId==='string'&&value.subscriptionId&&object(value.error)&&typeof value.error.code==='string'&&value.error.code&&typeof value.error.message==='string')return value as ApplicationEnvelope;
  if(value.type==='response'&&typeof value.requestId==='string'&&typeof value.ok==='boolean') {
    if(value.ok||object(value.error)&&typeof value.error.code==='string'&&typeof value.error.message==='string')return value as ApplicationEnvelope;
  }
  if(value.type==='conversation'&&typeof value.subscriptionId==='string'&&object(value.snapshot)) {
    const snapshot=value.snapshot;
    if(typeof snapshot.id==='string'&&typeof snapshot.revision==='number'&&Number.isSafeInteger(snapshot.revision)&&Array.isArray(snapshot.entries)&&object(snapshot.conversation))return value as ApplicationEnvelope;
  }
}

export function createBrowserController(host:BrowserHost) {
  let current:ApplicationClient|undefined;
  host.__durableReceive=value=>{const incoming=envelope(value);if(incoming)current?.receive(incoming);};
  const controller=new ConversationController(()=>{
    current=new ApplicationClient(host.DurableNative);return current;
  },{
    get:key=>{try{return host.localStorage.getItem(`durableagent.ui.${key}`);}catch{return null;}},
    set:(key,value)=>{try{host.localStorage.setItem(`durableagent.ui.${key}`,value);}catch{/* Selection is optional; the runtime remains authoritative. */}}
  });
  host.__durableOpenConversation=id=>{if(typeof id!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(id))return false;void controller.openTarget(id);return true;};
  const target=host.DurableNative?.initialConversationId?.();if(target)host.__durableOpenConversation(target);
  return controller;
}
