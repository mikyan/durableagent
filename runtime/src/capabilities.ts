import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
export async function capabilities() {
  const target={value:7};
  const weakRef=new WeakRef(target).deref()===target;
  const proxy=new Proxy(target,{get:(object,key)=>Reflect.get(object,key)}).value;
  const text=new TextDecoder().decode(new TextEncoder().encode('中文🌍'));
  let asyncIteration='';
  for await (const value of (async function*(){yield 'a';await Promise.resolve();yield 'b';})()) asyncIteration+=value;
  const db=new DatabaseSync(':memory:');
  let sqlite:unknown;
  try {sqlite=db.prepare('SELECT 42 AS answer').get()?.answer;} finally {db.close();}
  return {weakRef,proxy,text,asyncIteration,sqlite,moduleUrl:import.meta.url,random:randomUUID(),icu:process.versions.icu,unicodeProperty:/^\p{ASCII}*$/u.test('ASCII')&&!/^\p{ASCII}*$/u.test('中文'),intl:new Intl.Locale('zh-CN').language};
}
