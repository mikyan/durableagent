package dev.durableagent.probe

import org.junit.Assert.*
import org.junit.Test

/** Fake scheduler time exercises cancellation; the TLS socket remains the device-test boundary. */
class PendingExecutionWakeTest {
    private class Schedule {
        lateinit var timer:Runnable
        val workers=mutableListOf<Runnable>()
        var cancelled=false
        fun schedule(task:Runnable):AutoCloseable{timer=task;return AutoCloseable{cancelled=true}}
        fun execute(task:Runnable){workers.add(task)}
    }
    @Test fun normalCompletionBeforeTheDelayNeverQueuesAWake() {
        val tasks=Schedule()
        val ticket=PendingExecutionWake({true},{0L},{_,_,_->fail("Completed requests must not wake")},tasks::schedule,tasks::execute)
        ticket.close();tasks.timer.run()
        assertTrue(tasks.cancelled);assertTrue(tasks.workers.isEmpty())
    }
    @Test fun completionOrDeadlineWhileQueuedPreventsLateWake() {
        for(close in listOf(true,false)){
            val tasks=Schedule();var eligible=true
            val ticket=PendingExecutionWake({eligible},{0L},{_,_,_->fail("Stale queued requests must not wake")},tasks::schedule,tasks::execute)
            tasks.timer.run();assertEquals(1,tasks.workers.size)
            if(close)ticket.close()else eligible=false
            tasks.workers.single().run();ticket.close()
        }
    }
    @Test fun theWorkerCoalescesLaunchesSinceTheSocketWaitBeganAndChecksLiveEligibility() {
        val tasks=Schedule();var generation=3L;var eligible=true;var observed=-1L
        PendingExecutionWake({eligible},{generation},{value,pending,dispatch->observed=value;assertTrue(pending());eligible=false;assertFalse(pending());assertFalse(dispatch{fail("Expired preparation cannot dispatch")})},tasks::schedule,tasks::execute).use{
            generation=4L;tasks.timer.run();generation=5L;tasks.workers.single().run()
        }
        assertEquals(3L,observed)
    }
    @Test fun wakeOrQueueFailureCannotReplaceTheOriginalSocketOutcome() {
        val tasks=Schedule()
        PendingExecutionWake({true},{0L},{_,_,_->throw ExecutionChannelException("TERMUX_START_UNCONFIRMED")},tasks::schedule,tasks::execute).use{
            tasks.timer.run();tasks.workers.single().run()
        }
        PendingExecutionWake({true},{0L},{_,_,_->fail("Rejected worker cannot wake")},tasks::schedule,{throw java.util.concurrent.RejectedExecutionException()}).use{tasks.timer.run()}
    }
    @Test fun completionDuringPreparationRevokesTheDispatchPermit() {
        val tasks=Schedule();lateinit var ticket:PendingExecutionWake
        ticket=PendingExecutionWake({true},{0L},{_,_,dispatch->ticket.close();assertFalse(dispatch{fail("Completed preparation cannot launch")})},tasks::schedule,tasks::execute)
        tasks.timer.run();tasks.workers.single().run()
    }
    @Test fun completingTheSocketNeverJoinsAnAlreadyCommittedSystemCall() {
        val tasks=Schedule()
        val entered=java.util.concurrent.CountDownLatch(1)
        val release=java.util.concurrent.CountDownLatch(1)
        val closed=java.util.concurrent.CountDownLatch(1)
        val ticket=PendingExecutionWake({true},{0L},{_,_,dispatch->dispatch{entered.countDown();release.await(3,java.util.concurrent.TimeUnit.SECONDS)}},tasks::schedule,tasks::execute)
        tasks.timer.run()
        val worker=Thread(tasks.workers.single()).apply{start()}
        try{
            assertTrue(entered.await(1,java.util.concurrent.TimeUnit.SECONDS))
            Thread{ticket.close();closed.countDown()}.start()
            assertTrue("Original socket completion must not wait for the wake Binder call",closed.await(1,java.util.concurrent.TimeUnit.SECONDS))
        }finally{release.countDown();ticket.close();worker.join(1000)}
        assertFalse(worker.isAlive)
    }
}
