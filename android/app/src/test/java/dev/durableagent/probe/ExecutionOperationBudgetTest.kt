package dev.durableagent.probe

import org.junit.Assert.*
import org.junit.Test

/** Recovery policy only; real TLS framing and OEM freeze remain device acceptance boundaries. */
class ExecutionOperationBudgetTest {
    @Test fun aProvenUnsentRequestCanRecoverAndDeliverItsOriginalPayloadOnce() {
        val received=mutableListOf<String>();var awake=false
        val result=ExecutionOperationBudget({true},{0L}).execute(wake={awake=true}) {
            if(!awake)throw ExecutionNotDispatchedException("CONNECTION_UNCONFIRMED")
            received.add("original-fixed-payload");"acknowledged"
        }
        assertEquals("acknowledged",result)
        assertEquals(listOf("original-fixed-payload"),received)
    }
    @Test fun aLostReplyAfterSendingIsNeverReplayedEvenWithTheSamePublicCode() {
        val received=mutableListOf<String>()
        val failure=assertThrows(ExecutionChannelException::class.java){
            ExecutionOperationBudget({true},{0L}).execute(wake={fail("An unknown outcome cannot authorize another dispatch")}) {
                received.add("write-original");throw ExecutionChannelException("CONNECTION_UNCONFIRMED")
            }
        }
        assertEquals("CONNECTION_UNCONFIRMED",failure.code)
        assertEquals(listOf("write-original"),received)
    }
    @Test fun repeatedPreDispatchFailureHasNoSecondWakeOrThirdAttempt() {
        var wakes=0;var attempts=0
        assertThrows(ExecutionNotDispatchedException::class.java){
            ExecutionOperationBudget({true},{0L}).execute(wake={wakes++}) {attempts++;throw ExecutionNotDispatchedException("CONNECTION_UNCONFIRMED")}
        }
        assertEquals(1,wakes);assertEquals(2,attempts)
    }
    @Test fun cancellationDuringWakePreventsTheOriginalRequestFromBeingSent() {
        var eligible=true
        val error=assertThrows(ExecutionChannelException::class.java){
            ExecutionOperationBudget({eligible},{0L}).execute(wake={eligible=false}) {throw ExecutionNotDispatchedException("CONNECTION_ABSENT")}
        }
        assertEquals("CHANNEL_CLOSED",error.code)
    }
    @Test fun wakeAndAllRequestsConsumeTheSameThirtySecondBudget() {
        var now=0L;var attempted=false
        val budget=ExecutionOperationBudget({true},{now})
        now=12000
        val error=assertThrows(ExecutionChannelException::class.java){
            budget.execute(wake={assertEquals(10000L,budget.remaining());now=30000}) {
                assertFalse(attempted);attempted=true;now=18000
                throw ExecutionNotDispatchedException("CONNECTION_UNCONFIRMED")
            }
        }
        assertEquals("EXECUTION_WAIT_UNKNOWN",error.code)
    }
    @Test fun identityOrPolicyRefusalsNeverAuthorizeWake() {
        for(code in listOf("INSTANCE_MISMATCH","PROTOCOL_MISMATCH","SESSION_MISMATCH","SEND_STOPPED","DATA_SAVER_WAITING")){
            val original=ExecutionChannelException(code)
            val error=assertThrows(ExecutionChannelException::class.java){
                ExecutionOperationBudget({true},{0L}).execute(wake={fail("A refusal cannot authorize wake")}) {throw original}
            }
            assertSame(original,error)
        }
    }
    @Test fun anInFlightWakeConsumesTheSameAllowanceAsPreDispatchRecovery() {
        val budget=ExecutionOperationBudget({true},{0L})
        assertTrue(budget.claimRecovery());assertFalse(budget.claimRecovery())
        assertThrows(ExecutionNotDispatchedException::class.java){
            budget.execute(wake={fail("An in-flight wake already spent this operation's recovery")}){throw ExecutionNotDispatchedException("CONNECTION_UNCONFIRMED")}
        }
    }
    @Test fun concurrentRecoveryRequestsCanClaimOnlyOneWake() {
        val budget=ExecutionOperationBudget({true},{0L})
        val start=java.util.concurrent.CountDownLatch(1)
        val claims=java.util.concurrent.atomic.AtomicInteger()
        val threads=(1..8).map{Thread{start.await();if(budget.claimRecovery())claims.incrementAndGet()}.apply{start()}}
        start.countDown();threads.forEach{it.join(1000);assertFalse(it.isAlive)}
        assertEquals(1,claims.get())
    }
}
