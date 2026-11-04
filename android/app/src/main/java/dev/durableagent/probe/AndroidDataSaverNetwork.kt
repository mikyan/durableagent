package dev.durableagent.probe

import android.content.Context
import android.content.BroadcastReceiver
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Handler
import android.os.HandlerThread
import android.provider.Settings
import java.util.concurrent.atomic.AtomicBoolean

/** Android facts are independent of the JavaScript owner and of the UI's remembered network. */
class AndroidDataSaverNetwork(context:Context,private val changed:(DataSaverNetwork)->Unit = {}):AutoCloseable {
    private val context=context.applicationContext
    private val manager=this.context.getSystemService(ConnectivityManager::class.java)
    private val thread=HandlerThread("DataSaverNetwork").apply{start()}
    private val handler=Handler(thread.looper)
    private val closed=AtomicBoolean(false)
    @Volatile private var blocked:Pair<Network,Boolean>?=null
    private fun refresh(){handler.post{if(!closed.get())changed(current())}}
    private val callback=object:ConnectivityManager.NetworkCallback(){
        override fun onAvailable(network:Network){refresh()}
        override fun onLost(network:Network){refresh()}
        override fun onCapabilitiesChanged(network:Network,capabilities:NetworkCapabilities){refresh()}
        override fun onBlockedStatusChanged(network:Network,value:Boolean){if(manager.activeNetwork==network)blocked=network to value;refresh()}
    }
    private val receiver=object:BroadcastReceiver(){override fun onReceive(context:Context,intent:Intent){refresh()}}
    init{
        manager.registerDefaultNetworkCallback(callback,handler)
        this.context.registerReceiver(receiver,IntentFilter(ConnectivityManager.ACTION_RESTRICT_BACKGROUND_CHANGED),Context.RECEIVER_NOT_EXPORTED)
        refresh()
    }
    /** Query a coherent current snapshot on demand. Callback payloads only wake this read;
     * old networks/capabilities never restore eligibility after a newer event. */
    fun current():DataSaverNetwork=try{
        val active=manager.activeNetwork
        val capabilities=active?.let{manager.getNetworkCapabilities(it)}
        val boot=Settings.Global.getInt(context.contentResolver,Settings.Global.BOOT_COUNT,-1)
        val metered=manager.isActiveNetworkMetered
        if(active==null||capabilities==null||manager.activeNetwork!=active||boot<0)DataSaverNetwork(null,false,true)
        else DataSaverNetwork("$boot:${active.networkHandle}",
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)&&capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED),
            metered||!capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED),
            blocked?.let{it.first==active&&it.second}==true||manager.restrictBackgroundStatus==ConnectivityManager.RESTRICT_BACKGROUND_STATUS_ENABLED||!capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_RESTRICTED))
    }catch(_:Exception){DataSaverNetwork(null,false,true)}
    override fun close(){if(closed.compareAndSet(false,true)){runCatching{manager.unregisterNetworkCallback(callback)};runCatching{context.unregisterReceiver(receiver)};handler.removeCallbacksAndMessages(null);thread.quitSafely()}}
}
