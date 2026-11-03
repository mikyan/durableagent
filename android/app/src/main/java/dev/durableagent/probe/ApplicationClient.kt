package dev.durableagent.probe

import android.content.*
import android.os.*
import org.json.JSONObject

/** Typed-envelope transport only. SDK handles and SQLite are never exposed to WebView. */
class ApplicationClient(private val context:Context,private val mode:String="product",private val run:String?=null,private val receive:(Int,String)->Unit) {
    private val main=Handler(Looper.getMainLooper())
    private var remote:Messenger?=null
    private var bound=false
    private var disposed=false
    private var attempts=0
    private val pending=mutableListOf<Pair<Int,String>>()
    private val connections=mutableSetOf<String>()
    private data class Transfer(val count:Int,val kind:Int,val text:StringBuilder=StringBuilder(),var next:Int=0,var timeout:Runnable?=null)
    private val transfers=mutableMapOf<String,Transfer>()
    private data class Input(val json:String,val id:String=java.util.UUID.randomUUID().toString(),var index:Int=0,var timeout:Runnable?=null){val count=(json.length+47999)/48000}
    private val inputs=ArrayDeque<Input>()
    private val receiver=Messenger(Handler(Looper.getMainLooper()){message->
        if(message.what==16){
            val item=inputs.firstOrNull()
            if(item!=null&&message.data.getString("transfer")==item.id&&message.data.getInt("index")==item.index){item.timeout?.let(main::removeCallbacks);item.index++;if(item.index==item.count)inputs.removeFirst();sendInput()}
        }else if(message.what!=13)receive(message.what,message.data.getString("json")?:"{}") else {
            val data=message.data;val id=data.getString("transfer")?:"";val index=data.getInt("index");val count=data.getInt("count")
            if(index==0&&transfers.size<8&&count in 1..175){val item=Transfer(count,data.getInt("kind"));transfers[id]=item;item.timeout=Runnable{if(transfers.remove(id)===item)receive(0,"视图传输中断，请重新连接。")};main.postDelayed(item.timeout!!,30000)}
            val transfer=transfers[id]
            if(transfer==null||transfer.next!=index||transfer.count!=count){transfers.remove(id)?.timeout?.let(main::removeCallbacks);receive(0,"视图传输顺序无效，请重新连接。")}else{
                transfer.text.append(data.getString("json")?:"");transfer.next++
                send(14,JSONObject().put("transfer",id).put("index",index).toString())
                if(transfer.text.length>8*1024*1024){transfers.remove(id);transfer.timeout?.let(main::removeCallbacks);receive(0,"视图超过传输上限，数据仍保留。")}else if(transfer.next==count){transfers.remove(id);transfer.timeout?.let(main::removeCallbacks);receive(transfer.kind,transfer.text.toString())}
            }
        };true
    })
    private val connection=object:ServiceConnection {
        override fun onServiceConnected(name:ComponentName,binder:IBinder){remote=Messenger(binder);val batch=pending.toList();pending.clear();for((what,json)in batch)send(what,json)}
        override fun onServiceDisconnected(name:ComponentName){remote=null;receive(0,"运行宿主连接已断开，请重新连接查看状态。")}
    }
    fun connect(){main.post(object:Runnable{override fun run(){
        if(disposed||bound)return
        try{val intent=Intent(context,ApplicationService::class.java).putExtra("validationMode",mode).putExtra("validationRun",run);context.startService(intent);bound=context.bindService(intent,connection,Context.BIND_AUTO_CREATE);if(bound)return}catch(_:RuntimeException){}
        if(++attempts<30)main.postDelayed(this,100) else receive(0,"系统暂未允许连接运行宿主。")
    }})}
    fun post(json:String){main.post {if(disposed)return@post;runCatching{connections.add(JSONObject(json).getString("connectionId"));send(10,json)}}}
    fun control(what:Int,json:String=""){main.post {if(!disposed)send(what,json)}}
    private fun send(what:Int,json:String){val peer=remote;if(peer==null){pending.add(what to json);return}
        if(what==10&&json.length>48000){if(json.length>650000||inputs.size>=4){receive(0,"输入超过传输上限，尚未提交。");return};val first=inputs.isEmpty();inputs.addLast(Input(json));if(first)sendInput();return}
        try{peer.send(Message.obtain(null,what).apply{replyTo=receiver;data=Bundle().apply{putString("json",json)}})}catch(_:RemoteException){receive(0,"运行宿主连接已断开。")}}
    private fun sendInput(){val peer=remote?:return;val item=inputs.firstOrNull()?:return;val index=item.index
        try{peer.send(Message.obtain(null,15).apply{replyTo=receiver;data=Bundle().apply{putString("transfer",item.id);putInt("index",index);putInt("count",item.count);putString("json",item.json.substring(index*48000,minOf((index+1)*48000,item.json.length)))}})}catch(_:RemoteException){receive(0,"输入传输中断，请重新连接查看状态。");return}
        item.timeout=Runnable{if(inputs.firstOrNull()===item&&item.index==index){inputs.clear();receive(0,"输入传输确认超时，请重新连接查看状态。")}};main.postDelayed(item.timeout!!,30000)
    }
    fun disconnect(){main.post {disposed=true;for(id in connections)remote?.let {send(11,id)};connections.clear();for(item in transfers.values)item.timeout?.let(main::removeCallbacks);transfers.clear();for(item in inputs)item.timeout?.let(main::removeCallbacks);inputs.clear();pending.clear();if(bound)context.unbindService(connection);bound=false;remote=null}}
}
