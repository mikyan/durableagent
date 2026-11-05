export type StorageFailure={domain:'sdk';code:'STORAGE_CAPACITY'|'STORAGE_CORRUPT'|'STORAGE_VERSION_UNSUPPORTED'|'STORAGE_MIGRATION_FAILED'|'STORAGE_WRITE_FAILED';message:string;retained:true;retry:'free-space'|'compatible-version'|'diagnose'};
/** Inspect bounded platform/SDK error metadata only to classify; never publish raw SQL or values. */
export function storageFailure(error:unknown):StorageFailure|undefined {
  const parts:string[]=[];const seen=new Set<unknown>();const pending=[error];
  while(pending.length&&parts.length<8){const item=pending.shift();if(!item||typeof item!=='object'||seen.has(item))continue;seen.add(item);const value=item as {code?:unknown;message?:unknown;cause?:unknown;errors?:unknown};parts.push(String(value.code??'').slice(0,120)+' '+String(value.message??'').slice(0,1000));pending.push(value.cause);if(Array.isArray(value.errors))pending.push(...value.errors.slice(0,4));}
  const detail=parts.join(' ');
  if(/SQLITE_FULL|database or disk is full|ENOSPC/i.test(detail))return {domain:'sdk',code:'STORAGE_CAPACITY',message:'会话存储空间不足，未确认本次保存。已保留历史和发送材料；释放设备空间后重新核验同一次操作。',retained:true,retry:'free-space'};
  if(/SQLITE_CORRUPT|SQLITE_NOTADB|database disk image is malformed|not a database/i.test(detail))return {domain:'sdk',code:'STORAGE_CORRUPT',message:'会话存储损坏，原数据已保留且运行关闭。请保留当前安装以便检查，不要清除应用数据。',retained:true,retry:'diagnose'};
  if(/APP_FORMAT_UNSUPPORTED|newer (?:than supported|version)|requires migration from version|scope.*mismatch|history.*mismatch|fork.*mismatch/i.test(detail))return {domain:'sdk',code:'STORAGE_VERSION_UNSUPPORTED',message:'会话记录版本不兼容，原数据已保留且运行关闭。请使用兼容的新版本；安全可读的原生草稿仍可查看。',retained:true,retry:'compatible-version'};
  if(/APP_MIGRATION_INVALID|migration.*(?:failed|invalid|interrupted)/i.test(detail))return {domain:'sdk',code:'STORAGE_MIGRATION_FAILED',message:'会话记录迁移未完成，原数据已保留且运行关闭。请保留当前安装并使用兼容版本重试。',retained:true,retry:'compatible-version'};
  if(/SQLITE_IOERR|SQLITE_READONLY|disk I\/O error|read-only database|EIO/i.test(detail))return {domain:'sdk',code:'STORAGE_WRITE_FAILED',message:'会话存储写入失败，尚未确认本次保存；原数据保留，请检查设备存储后核验同一次操作。',retained:true,retry:'diagnose'};
}
