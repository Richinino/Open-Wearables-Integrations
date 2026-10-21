package sk.zdravie.app.controller

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test
import sk.zdravie.app.data.*
import sk.zdravie.app.model.*

@OptIn(ExperimentalCoroutinesApi::class)
class SessionControllerTest {
    private fun session(id:String="a",version:Long=0,status:String="active") = AppSession(
        Account(id,"Synthetic",null,"$id@example.test","user",status,status=="active",false,"dark"),
        AccountIdentity(id,id,false,version),5000,true)
    private fun day(steps:Long) = DaySummary("2026-10-20",true,steps,null,null,null,null,null,null,null,null,null,emptyList())
    private class MemoryStore(var value:SessionCredential?=null):CredentialStore {
        var refusePersistent=false
        override fun read()=value
        override fun write(value:SessionCredential?) {
            this.value=value?.takeIf { it.persistent }
            if(value != null && refusePersistent) error("synthetic storage fault")
        }
    }
    private inner class FakeApi:MobileApi {
        var current=session()
        var error:ApiFailure?=null
        var calls=0
        var dataCalls=0
        var duringData:(()->Unit)?=null
        var logoutCookies=mutableListOf<String>()
        override fun login(email:String,password:String,remember:Boolean):LoginResult {
            calls++
            error?.let { throw it }
            current=session(email)
            return LoginResult(current,SessionCredential("owi_session=$email",5000,remember))
        }
        override fun session(credential:SessionCredential):AppSession {
            calls++
            error?.let { throw it }
            return current
        }
        override fun data(credential:SessionCredential,session:AppSession):DatasetResult {
            dataCalls++
            error?.let { throw it }
            duringData?.also { duringData=null }?.invoke()
            return DatasetResult(listOf(day(if(session.account.id=="a") 100 else 900)),"2026-10-20T10:00:00Z")
        }
        override fun logout(credential:SessionCredential) { logoutCookies.add(credential.cookie) }
    }
    @Test fun `new login clears old account before any response`() = runTest {
        val api=FakeApi(); val store=MemoryStore()
        val controller=SessionController(api,store,this,StandardTestDispatcher(testScheduler),{0})
        controller.login("a","synthetic",true); advanceUntilIdle()
        assertEquals(100L,controller.state.value.days.single().steps)
        controller.login("b","synthetic",true)
        assertNull(controller.state.value.session)
        assertTrue(controller.state.value.days.isEmpty())
        assertNull(store.value)
        advanceUntilIdle()
        assertEquals("b",controller.state.value.session?.account?.id)
        assertEquals(900L,controller.state.value.days.single().steps)
    }
    @Test fun `logout is immediate and old network result cannot restore data`() = runTest {
        val api=FakeApi(); val store=MemoryStore()
        val controller=SessionController(api,store,this,StandardTestDispatcher(testScheduler),{0})
        api.duringData={controller.logout()}
        controller.login("a","synthetic",true); advanceUntilIdle()
        assertNull(controller.state.value.session)
        assertTrue(controller.state.value.days.isEmpty())
        assertNull(store.value)
        assertEquals(listOf("owi_session=a"),api.logoutCookies)
    }
    @Test fun `superseded account result cannot overwrite new login`() = runTest {
        val api=FakeApi(); val store=MemoryStore()
        val controller=SessionController(api,store,this,StandardTestDispatcher(testScheduler),{0})
        api.duringData={controller.logout();controller.login("b","synthetic",true)}
        controller.login("a","synthetic",true); advanceUntilIdle()
        assertEquals("b",controller.state.value.session?.account?.id)
        assertEquals(900L,controller.state.value.days.single().steps)
        assertEquals("owi_session=b",store.value?.cookie)
    }
    @Test fun `revoked session clears both memory and persisted cookie`() = runTest {
        val api=FakeApi(); val store=MemoryStore()
        val controller=SessionController(api,store,this,StandardTestDispatcher(testScheduler),{0})
        controller.login("a","synthetic",true); advanceUntilIdle()
        api.error=ApiFailure(401,"Relácia vypršala.")
        controller.refresh(); advanceUntilIdle()
        assertNull(controller.state.value.session)
        assertTrue(controller.state.value.days.isEmpty())
        assertNull(store.value)
        assertEquals("Relácia vypršala.",controller.state.value.error)
    }
    @Test fun `network failure preserves only same account data with explicit error`() = runTest {
        val api=FakeApi(); val store=MemoryStore()
        val controller=SessionController(api,store,this,StandardTestDispatcher(testScheduler),{0})
        controller.login("a","synthetic",true); advanceUntilIdle()
        api.error=ApiFailure(503,"Server je nedostupný.")
        controller.refresh(); advanceUntilIdle()
        assertEquals("a",controller.state.value.session?.account?.id)
        assertEquals(100L,controller.state.value.days.single().steps)
        assertEquals("Server je nedostupný.",controller.state.value.error)
        assertFalse(controller.state.value.refreshing)
    }
    @Test fun `expired saved credential is discarded without network request`() = runTest {
        val api=FakeApi(); val store=MemoryStore(SessionCredential("owi_session=expired",10,true))
        val controller=SessionController(api,store,this,StandardTestDispatcher(testScheduler),{20})
        controller.restore(); advanceUntilIdle()
        assertNull(store.value)
        assertEquals(0,api.calls)
        assertNull(controller.state.value.session)
        assertFalse(controller.state.value.loading)
    }
    @Test fun `pending account shows waiting state and never requests health data`() = runTest {
        val api=FakeApi(); val store=MemoryStore(SessionCredential("owi_session=pending",5000,true))
        api.current=session(status="pending")
        val controller=SessionController(api,store,this,StandardTestDispatcher(testScheduler),{0})
        controller.restore(); advanceUntilIdle()
        assertEquals("pending",controller.state.value.session?.account?.status)
        assertEquals(0,api.dataCalls)
        assertTrue(controller.state.value.days.isEmpty())
        assertTrue(controller.state.value.hasLoaded)
    }
    @Test fun `failed secure persistence clears credential and does not load data`() = runTest {
        val api=FakeApi(); val store=MemoryStore().apply { refusePersistent=true }
        val controller=SessionController(api,store,this,StandardTestDispatcher(testScheduler),{0})
        controller.login("a","synthetic",true); advanceUntilIdle()
        assertNull(controller.state.value.session)
        assertNull(store.value)
        assertEquals(0,api.dataCalls)
        assertTrue(controller.state.value.error!!.contains("bez zapamätania"))
    }
    @Test fun `changed pairing generation drops previously loaded days before failed reload`() = runTest {
        val api=FakeApi(); val store=MemoryStore()
        val controller=SessionController(api,store,this,StandardTestDispatcher(testScheduler),{0})
        controller.login("a","synthetic",true); advanceUntilIdle()
        api.current=session(version=1)
        api.duringData={throw ApiFailure(503,"synthetic")}
        controller.refresh(); advanceUntilIdle()
        assertEquals(1L,controller.state.value.session?.identity?.sessionVersion)
        assertTrue(controller.state.value.days.isEmpty())
    }
}
