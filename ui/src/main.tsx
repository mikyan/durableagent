import {createRoot} from 'react-dom/client';
import {App} from './App';
import {createBrowserController} from './browser';
import './style.css';

const controller=createBrowserController(window);
createRoot(document.getElementById('root')!).render(<App controller={controller}/>);
window.addEventListener('pagehide',()=>controller.disconnect());
window.addEventListener('pageshow',event=>{if(event.persisted)void controller.connect();});
