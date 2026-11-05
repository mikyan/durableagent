// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,act,waitFor} from '@testing-library/react';
import {ExtensionPage} from '../src/extension-host';
import type {ExtensionCatalog} from '../../runtime/src/extension-protocol';
import type {TimelineClient} from '../src/extensions/timeline';
afterEach(cleanup);
const catalog:ExtensionCatalog={items:[{descriptor:{id:'timeline',title:'时间线',ui:'timeline'},packaged:true,agent:{state:'not-provided'},ui:{state:'packaged'}}]};
const client={request:async()=>catalog} as unknown as TimelineClient;
it('page mounted state comes from successful React commit, not opening intent or pending lazy import',async()=>{
 let finish:(value:any)=>void=()=>{};const loader=()=>new Promise<any>(resolve=>{finish=resolve;});
 render(<ExtensionPage client={client} conversationId="one" timelineLoader={loader}/>);
 fireEvent.click(await screen.findByTestId('toggle-timeline'));
 expect(screen.queryByText('本页已挂载')).toBeNull();expect(screen.getByText('界面正在加载')).toBeTruthy();
 await act(async()=>{finish({default:()=> <div>真正的时间线</div>});await Promise.resolve();});
 expect(await screen.findByText('本页已挂载')).toBeTruthy();fireEvent.click(screen.getByTestId('toggle-timeline'));
 expect(screen.queryByText('本页已挂载')).toBeNull();expect(screen.queryByText('真正的时间线')).toBeNull();
});
it('asynchronous loader failure is visible and never reported as mounted or as conversation completion',async()=>{
 const consoleError=vi.spyOn(console,'error').mockImplementation(()=>{});let reject:(error:Error)=>void=()=>{};
 try{render(<ExtensionPage client={client} conversationId="one" timelineLoader={()=>new Promise<any>((_,fail)=>{reject=fail;})}/>);
 fireEvent.click(await screen.findByTestId('toggle-timeline'));
 await act(async()=>{reject(Error('Synthetic module unavailable'));await Promise.resolve();});
 await waitFor(()=>expect(screen.getByText('界面挂载失败')).toBeTruthy());expect(screen.queryByText('本页已挂载')).toBeNull();expect(screen.getByRole('alert').textContent).toContain('会话仍由应用服务管理');
 }finally{consoleError.mockRestore();}
});
