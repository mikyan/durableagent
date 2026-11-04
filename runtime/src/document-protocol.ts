/** Original capabilities are separate from immutable attachment representations. */
export type DocumentMethod='document.select'|'document.list'|'document.describe'|'document.query'|'document.verify';
export type OriginalResource={protocol:1;resourceId:string;namespace:string;source:'saf';original:true;uri:string;displayName:string;mimeType:string;provider?:string;byteLength?:number;lastModified?:number;providerFlags:number;networkAccess:'unknown';availability:'available'|'permission_required'|'not_found'|'unavailable';reasonCode?:string;reason?:string;grant:{read:boolean;write:boolean;persistedRead:boolean;persistedWrite:boolean}};
export type OriginalResourcePage={resources:OriginalResource[];nextCursor:string|null};
