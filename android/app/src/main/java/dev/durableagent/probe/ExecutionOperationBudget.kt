package dev.durableagent.probe

/** One native operation's total deadline and one recovery after initial readiness. */
internal class ExecutionOperationBudget(
    private val eligible:()->Boolean,
    private val now:()->Long={android.os.SystemClock.elapsedRealtime()},
) {
    private val deadline=now()+30000
    private val recoveryClaimed=java.util.concurrent.atomic.AtomicBoolean(false)
    fun remaining(limit:Long=10000):Long {
        if(Thread.currentThread().isInterrupted||!eligible())throw ExecutionChannelException("CHANNEL_CLOSED")
        val left=deadline-now()
        if(left<=0)throw ExecutionChannelException("EXECUTION_WAIT_UNKNOWN")
        return minOf(left,limit)
    }
    fun claimRecovery():Boolean {remaining();return recoveryClaimed.compareAndSet(false,true)}
    fun <T> execute(wake:()->Unit,attempt:()->T):T {
        remaining()
        return try{attempt()}catch(error:ExecutionNotDispatchedException){
            if(!claimRecovery())throw error
            wake();remaining()
            attempt() // A second failure is returned; this operation has spent its recovery allowance.
        }
    }
}
