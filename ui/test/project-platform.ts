
import {ApplicationClient} from '../src/client';
import {ConversationController} from '../src/controller';
import {InputPlatform} from './input-platform';
import type {ApplicationRequest} from '../../runtime/src/application-protocol';
import type {ProjectCatalog} from '../../runtime/src/project-protocol';

export function projectWire(){
  const native=new InputPlatform(),requests:ApplicationRequest[]=[];
  const summary={id:'one',title:'当前会话',model:{provider:'fixture',modelId:'one',name:'模型'},workspaceId:'default',projectId:null as string|null,createdAt:1,phase:'idle' as const};native.rememberConversation(summary);
  let catalog:ProjectCatalog={version:0,projects:[],workspaces:[{id:'default',name:'默认工作区',version:1,path:'/data/data/com.termux/files/home',environment:'termux',position:{state:'unverified',reason:'执行环境尚未就绪'}}],selection:{id:'one',projectId:null,workspaceId:'default',associationVersion:1,position:{state:'unverified',reason:'执行环境尚未就绪'}}};
  let busy=false,lose=false,failListing=false;const receipts=new Map<string,ProjectCatalog>();
  const controller=new ConversationController(()=>{
    const client=new ApplicationClient({postMessage:encoded=>{
      const request:ApplicationRequest=JSON.parse(encoded);requests.push(request);
      if(request.method.startsWith('input.')){void native.handle(request).then(response=>client.receive(response));return;}
      const reply=(value:unknown)=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:true,value:structuredClone(value)});
      const reject=(code:string,message:string)=>client.receive({type:'response',protocol:1,connectionId:request.connectionId,requestId:request.requestId,ok:false,error:{code,message}});
      const snapshot=()=>({id:'one',revision:catalog.version+1,conversation:summary,entries:[],phase:'idle',storedSeq:1});
      if(request.method==='status'){reply({phase:'ready',extensions:['conversation','projects']});return;}
      if(request.method==='list'){if(failListing){reject('HOST_NOT_READY','刷新会话列表暂不可用');return;}reply({conversations:[summary]});return;}
      if(request.method==='history'){reply({items:[]});return;}
      if(request.method==='sendList'){reply({items:[]});return;}
      if(request.method==='projects.get'){reply({...catalog,...(request.payload?.id?{}:{selection:undefined})});return;}
      if(request.method.startsWith('projects.')||request.method.startsWith('workspaces.')){
        const p=request.payload!,operation=String(p.operationId);
        if(receipts.has(operation)){reply(receipts.get(operation));return;}
        if(p.expectedVersion!==catalog.version){reject('PROJECT_CONFLICT','项目配置已更新，请刷新后重试。');return;}
        if(busy&&request.method==='projects.select'){reject('LOCATION_BUSY','仍有未结算输入，位置未修改；结束后请重新发起。');return;}
        if(request.method==='workspaces.create')catalog={...catalog,workspaces:[...catalog.workspaces,{id:String(p.id),name:String(p.name),path:String(p.path),environment:'termux',version:1,position:{state:'unverified',reason:'尚未核验实际目录'}}]};
        if(request.method==='workspaces.update')catalog={...catalog,workspaces:catalog.workspaces.map(item=>item.id===p.id?{...item,...(p.name?{name:String(p.name)}:{}),...(p.path?{path:String(p.path),version:item.version+1}:{})}:item)};
        if(request.method==='projects.create')catalog={...catalog,projects:[...catalog.projects,{id:String(p.id),name:String(p.name),workspaceId:String(p.workspaceId)}]};
        if(request.method==='projects.rename')catalog={...catalog,projects:catalog.projects.map(item=>item.id===p.id?{...item,name:String(p.name)}:item)};
        if(request.method==='projects.select'){summary.projectId=p.projectId as string|null;summary.workspaceId=catalog.projects.find(item=>item.id===p.projectId)?.workspaceId??'default';catalog={...catalog,selection:{id:'one',projectId:summary.projectId,workspaceId:summary.workspaceId,associationVersion:catalog.selection!.associationVersion+1,position:catalog.workspaces.find(item=>item.id===summary.workspaceId)!.position}};}
        catalog={...catalog,version:catalog.version+1};receipts.set(operation,structuredClone(catalog));if(lose){lose=false;return;}reply(catalog);return;
      }
      reply(snapshot());
    }},35);return client;
  });
  return {controller,requests,native,get catalog(){return catalog;},set busy(value:boolean){busy=value;},set lose(value:boolean){lose=value;},set failListing(value:boolean){failListing=value;}};
}
