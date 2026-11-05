package dev.durableagent.probe

import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** A one-shot hint while the original socket is still pending; it owns no response or retry. */
internal class PendingExecutionWake(
    private val eligible:()->Boolean,
    generation:()->Long,
    wake:(Long,()->Boolean,((()->Unit)->Boolean))->Unit,
    schedule:(Runnable)->AutoCloseable={task->val future=timers.schedule(task,1000,TimeUnit.MILLISECONDS);AutoCloseable{future.cancel(false)}},
    execute:(Runnable)->Unit={workers.execute(it)},
):AutoCloseable {
    private val state=AtomicInteger(ACTIVE)
    private val observedGeneration=generation()
    private val timer=try{schedule(Runnable {
        if(pending()) {
            // The timer never hashes APKs, waits for startup locks or opens sockets.
            runCatching{execute(Runnable{if(pending())runCatching{wake(observedGeneration,::pending,::dispatchIfPending)}})}
        }
    })}catch(_:Exception){null}
    private fun pending():Boolean=state.get()!=CLOSED&&runCatching{eligible()}.getOrDefault(false)
    private fun dispatchIfPending(action:()->Unit):Boolean {
        if(!pending()||!state.compareAndSet(ACTIVE,DISPATCH_COMMITTED))return false
        // Completion before this CAS revokes dispatch. After it the fixed system
        // call is committed; close must not join a possibly stalled Binder call.
        action();return true
    }
    override fun close(){state.set(CLOSED);runCatching{timer?.close()}}
    companion object {
        private const val ACTIVE=0
        private const val CLOSED=1
        private const val DISPATCH_COMMITTED=2
        private val timers=ScheduledThreadPoolExecutor(1){task->Thread(task,"ExecutionWakeTimer").apply{isDaemon=true}}.apply{removeOnCancelPolicy=true}
        private val workers=ThreadPoolExecutor(2,2,0L,TimeUnit.MILLISECONDS,ArrayBlockingQueue(8),{task->Thread(task,"ExecutionPendingWake").apply{isDaemon=true}},ThreadPoolExecutor.AbortPolicy())
    }
}
