import {mkdir,realpath,readFile} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {openNodeSqliteDatabase} from '@earendil-works/chord/sqlite/node';
import {SqliteStorage} from '@earendil-works/pi-durable/storage/sqlite';
import type {Storage} from '@earendil-works/pi-durable';

// Covers concurrent callers in this JS host. Android also holds an OS file lock before
// opening Node, so a second process cannot reach migrations or create a Session.
const owners=new Set<string>();
export async function auditStorageSecret(path:string,secret:string) {
  const scanned:string[]=[];
  for(const [name,suffix] of [['db',''],['wal','-wal'],['shm','-shm']]) {
    const bytes=await readFile(path+suffix).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return undefined;throw error;});
    if(!bytes)continue;
    if(bytes.includes(Buffer.from(secret,'utf8'))||bytes.includes(Buffer.from(secret,'utf16le')))throw new Error('Credential persistence audit failed');
    scanned.push(name);
  }
  return scanned;
}
export async function openOwnedStorage(path:string,secret?:string) {
  await mkdir(dirname(resolve(path)),{recursive:true});
  const canonical=await realpath(path).catch(async()=>join(await realpath(dirname(resolve(path))),basename(path)));
  const key=process.platform==='win32'?canonical.toLowerCase():canonical;
  if(owners.has(key))throw new Error('Storage domain already owned');
  owners.add(key);
  try {
    const db=await openNodeSqliteDatabase(canonical);
    try {
      await db.exec('PRAGMA synchronous = FULL');
      const journal=await db.get<{journal_mode:string}>('PRAGMA journal_mode');
      const sync=await db.get<{synchronous:number}>('PRAGMA synchronous');
      if(journal?.journal_mode!=='wal'||sync?.synchronous!==2)throw new Error('Required SQLite durability configuration unavailable');
      const configuration={journalMode:journal.journal_mode,synchronous:sync.synchronous,
        version:(await db.get<{version:string}>('SELECT sqlite_version() AS version'))!.version,
        sourceId:(await db.get<{source:string}>('SELECT sqlite_source_id() AS source'))!.source,
        busyTimeout:(await db.get<{timeout:number}>('PRAGMA busy_timeout'))!.timeout,
        walAutoCheckpoint:(await db.get<{wal_autocheckpoint:number}>('PRAGMA wal_autocheckpoint'))!.wal_autocheckpoint,
        compileOptions:(await db.all<{compile_options:string}>('PRAGMA compile_options')).map(row=>row.compile_options)};
      const actual=await SqliteStorage.open(db);
      let closing:Promise<void>|undefined;
      const storage:Storage=new Proxy(actual,{
        get(target,property){
          if(property==='close')return (context:Parameters<Storage['close']>[0])=>closing??=(async()=>{await actual.close(context);owners.delete(key);})();
          if(property==='commit'&&secret)return async(...args:Parameters<Storage['commit']>)=>{
            if(JSON.stringify(args[0]).includes(secret))throw new Error('Credential persistence blocked');
            return actual.commit(...args);
          };
          const value=Reflect.get(target,property,target);
          return typeof value==='function'?value.bind(target):value;
        }
      });
      return {storage,configuration};
    } catch(error) {await db.close().catch(()=>{});throw error;}
  } catch(error) {owners.delete(key);throw error;}
}
