package dev.durableagent.probe

import android.content.*
import android.os.*
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class RuntimeClient(private val context:Context) {
    private var remote:Messenger?=null
    private val connected=CountDownLatch(1)
    private val main=Handler(Looper.getMainLooper())
    private var bound=false
    private var disconnected=false
    private var attempts=0
    @Volatile private var state="{\"status\":\"connecting\"}"
    @Volatile private var response:CountDownLatch?=null
    private val receiver=Messenger(Handler(Looper.getMainLooper()) { message -> state=message.data.getString("state")?:state;response?.countDown();true })
    private val connection=object:ServiceConnection {
        override fun onServiceConnected(name:ComponentName,binder:IBinder) {remote=Messenger(binder);connected.countDown()}
        override fun onServiceDisconnected(name:ComponentName) {remote=null;state="{\"status\":\"disconnected\"}"}
    }
    // Some vendors defer a service while the launching Activity is not visible
    // yet. A bounded retry keeps that platform state observable without crashing UI.
    fun connectAsync() { main.post(object:Runnable {
        override fun run() {
            if(disconnected || bound)return
            try {
                val intent=Intent(context,RuntimeService::class.java)
                context.startService(intent)
                bound=context.bindService(intent,connection,Context.BIND_AUTO_CREATE)
                if(bound)return
            } catch(error:RuntimeException) {state=JSONObject().put("status","connecting").put("error",error.javaClass.simpleName).toString()}
            if(++attempts<30)main.postDelayed(this,100) else {state="{\"status\":\"failed\",\"phase\":\"service-connect\",\"error\":\"Platform refused service binding\"}";connected.countDown()}
        }
    }) }
    fun connect() { check(Looper.myLooper()!=Looper.getMainLooper());connectAsync();check(connected.await(10,TimeUnit.SECONDS)&&remote!=null){"Service connection failed: $state"} }
    fun command(command:String) { checkNotNull(remote){"Not connected"}.send(Message.obtain(null,1).apply {data=Bundle().apply {putString("command",command)}}) }
    fun poll() { remote?.send(Message.obtain(null,2).apply {replyTo=receiver}) }
    fun cachedState()=state
    fun snapshot():JSONObject { check(Looper.myLooper()!=Looper.getMainLooper()); val latch=CountDownLatch(1);response=latch;poll();check(latch.await(5,TimeUnit.SECONDS)){"Runtime snapshot timed out"};return JSONObject(state) }
    fun disconnect() {disconnected=true;if(bound)context.unbindService(connection);bound=false;remote=null}
}
