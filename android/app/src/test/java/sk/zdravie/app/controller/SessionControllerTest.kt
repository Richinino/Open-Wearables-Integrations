package sk.zdravie.app.controller

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.TestScope
import org.json.JSONObject
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
            return DatasetResult(listOf(day(if(session.account.id=="a") 100 else 900)),"2026-10-20T10:00:00Z",
                Dataset("Europe/Bratislava", null, null, null, null, null, emptyList()))
        }
        override fun logout(credential:SessionCredential) { logoutCookies.add(credential.cookie) }
        var insightsResult:DailyResult<InsightsResult> = DailyResult.Ok(InsightsResult("ready",emptyList()))
        var journalResult:DailyResult<JournalState> = DailyResult.Ok(JournalState(null,0))
        var saveResult:DailyResult<JournalState> = DailyResult.Ok(JournalState(null,1))
        var duringDaily:(()->Unit)?=null
        var saved=mutableListOf<Triple<String,String,Long>>()
        val dailyCalls=mutableListOf<String>()
        override fun insights(credential:SessionCredential,session:AppSession,day:String):DailyResult<InsightsResult> {
            dailyCalls.add("insights:${session.account.id}:$day")
            duringDaily?.also { duringDaily=null }?.invoke()
            error?.let { throw it }
            return insightsResult
        }
        override fun journal(credential:SessionCredential,session:AppSession,day:String):DailyResult<JournalState> {
            dailyCalls.add("journal:${session.account.id}:$day")
            error?.let { throw it }
            return journalResult
        }
        override fun saveJournal(credential:SessionCredential,session:AppSession,day:String,patch:JSONObject,expectedRevision:Long):DailyResult<JournalState> {
            saved.add(Triple(day,patch.toString(),expectedRevision))
            return saveResult
        }
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

    private fun entry(energy:Int?=null,travel:Boolean?=null,note:String?=null) = JournalEntry(
        JournalKeys.RATINGS.associateWith { if(it=="morning_energy") energy else null },
        JournalKeys.CONTEXT.associateWith { if(it=="travel") travel else null }, note)
    private fun TestScope.loggedIn(api:FakeApi=FakeApi()):Pair<FakeApi,SessionController> {
        val controller=SessionController(api,MemoryStore(),this,StandardTestDispatcher(testScheduler),{0})
        controller.login("a","synthetic",true); advanceUntilIdle()
        return api to controller
    }
    @Test fun `loadDaily loads insights and journal for the day`() = runTest {
        val (api,controller)=loggedIn()
        assertNull(controller.state.value.daily)
        controller.loadDaily("2026-10-22")
        assertEquals("2026-10-22",controller.state.value.daily?.day)
        assertNull(controller.state.value.daily?.insights)
        advanceUntilIdle()
        val daily=controller.state.value.daily!!
        assertTrue(daily.insights is DailyResult.Ok)
        assertEquals(DailyResult.Ok(JournalState(null,0)),daily.journal)
        assertEquals(setOf("insights:a:2026-10-22","journal:a:2026-10-22"),api.dailyCalls.toSet())
        assertEquals(100L,controller.state.value.days.single().steps)
    }
    @Test fun `unsupported blocks stay unsupported and the rest of the state is untouched`() = runTest {
        val api=FakeApi().apply { insightsResult=DailyResult.Unsupported; journalResult=DailyResult.Unavailable }
        val (_,controller)=loggedIn(api)
        controller.loadDaily("2026-10-22"); advanceUntilIdle()
        assertEquals(DailyResult.Unsupported,controller.state.value.daily?.insights)
        assertEquals(DailyResult.Unavailable,controller.state.value.daily?.journal)
        assertNull(controller.state.value.error)
        assertEquals("a",controller.state.value.session?.account?.id)
    }
    @Test fun `daily response for a logged out session is dropped`() = runTest {
        val (api,controller)=loggedIn()
        api.duringDaily={controller.logout()}
        controller.loadDaily("2026-10-22"); advanceUntilIdle()
        assertNull(controller.state.value.session)
        assertNull(controller.state.value.daily)
    }
    @Test fun `daily response from before a new login cannot reach the new account`() = runTest {
        val (api,controller)=loggedIn()
        api.duringDaily={controller.login("b","synthetic",true)}
        controller.loadDaily("2026-10-22"); advanceUntilIdle()
        assertEquals("b",controller.state.value.session?.account?.id)
        assertNull(controller.state.value.daily)
    }
    @Test fun `daily auth failure clears the session like any other call`() = runTest {
        val (api,controller)=loggedIn()
        api.duringDaily={api.error=ApiFailure(409,"Relácia sa zmenila.")}
        controller.loadDaily("2026-10-22"); advanceUntilIdle()
        assertNull(controller.state.value.session)
        assertNull(controller.state.value.daily)
        assertEquals("Relácia sa zmenila.",controller.state.value.error)
    }
    @Test fun `identity change on refresh drops daily but same identity keeps it`() = runTest {
        val (api,controller)=loggedIn()
        controller.loadDaily("2026-10-22"); advanceUntilIdle()
        controller.refresh(); advanceUntilIdle()
        assertEquals("2026-10-22",controller.state.value.daily?.day)
        assertTrue(controller.state.value.daily?.journal is DailyResult.Ok)
        api.current=session(version=1)
        controller.refresh(); advanceUntilIdle()
        assertNull(controller.state.value.daily)
    }
    @Test fun `saveJournal sends only changed fields with the loaded revision`() = runTest {
        val api=FakeApi().apply { journalResult=DailyResult.Ok(JournalState(entry(energy=3,note="stará"),5)) }
        val (_,controller)=loggedIn(api)
        controller.loadDaily("2026-10-22"); advanceUntilIdle()
        api.saveResult=DailyResult.Ok(JournalState(entry(energy=3,travel=true,note="nová"),6))
        controller.saveJournal("2026-10-22",entry(energy=3,travel=true,note="nová"))
        assertTrue(controller.state.value.daily!!.saving)
        advanceUntilIdle()
        val (day,patch,revision)=api.saved.single()
        assertEquals("2026-10-22",day); assertEquals(5L,revision)
        val sent=JSONObject(patch)
        assertEquals(setOf("context","note"),sent.keys().asSequence().toSet())
        assertEquals(setOf("travel"),sent.getJSONObject("context").keys().asSequence().toSet())
        val daily=controller.state.value.daily!!
        assertFalse(daily.saving); assertNull(daily.saveError)
        assertEquals(6L,((daily.journal) as DailyResult.Ok).value.revision)
    }
    @Test fun `clearing a value sends null and an unchanged entry sends nothing`() = runTest {
        val api=FakeApi().apply { journalResult=DailyResult.Ok(JournalState(entry(energy=3,note="x"),1)) }
        val (_,controller)=loggedIn(api)
        controller.loadDaily("2026-10-22"); advanceUntilIdle()
        controller.saveJournal("2026-10-22",entry(energy=3,note="x")); advanceUntilIdle()
        assertTrue(api.saved.isEmpty())
        controller.saveJournal("2026-10-22",entry()); advanceUntilIdle()
        val sent=JSONObject(api.saved.single().second)
        assertTrue(sent.isNull("morning_energy")); assertTrue(sent.isNull("note"))
        assertFalse(sent.has("context"))
    }
    @Test fun `conflict keeps the loaded state and offers the servers newer one`() = runTest {
        val api=FakeApi().apply { journalResult=DailyResult.Ok(JournalState(entry(energy=3),5)) }
        val (_,controller)=loggedIn(api)
        controller.loadDaily("2026-10-22"); advanceUntilIdle()
        val newer=JournalState(entry(energy=1,note="z telefónu"),7)
        api.saveResult=DailyResult.Conflict(newer)
        controller.saveJournal("2026-10-22",entry(energy=4)); advanceUntilIdle()
        var daily=controller.state.value.daily!!
        assertFalse(daily.saving)
        assertEquals(newer,daily.conflict)
        assertEquals(5L,(daily.journal as DailyResult.Ok).value.revision)
        assertNotNull(daily.saveError)
        controller.adoptConflict("2026-10-22")
        daily=controller.state.value.daily!!
        assertNull(daily.conflict); assertNull(daily.saveError)
        assertEquals(DailyResult.Ok(newer),daily.journal)
    }
    @Test fun `unavailable save keeps the form state with an error`() = runTest {
        val api=FakeApi().apply { journalResult=DailyResult.Ok(JournalState(null,0)) }
        val (_,controller)=loggedIn(api)
        controller.loadDaily("2026-10-22"); advanceUntilIdle()
        api.saveResult=DailyResult.Unavailable
        controller.saveJournal("2026-10-22",entry(energy=2)); advanceUntilIdle()
        val daily=controller.state.value.daily!!
        assertFalse(daily.saving); assertNotNull(daily.saveError)
        assertEquals(0L,(daily.journal as DailyResult.Ok).value.revision)
    }
    @Test fun `save result after logout is dropped`() = runTest {
        val api=FakeApi().apply { journalResult=DailyResult.Ok(JournalState(null,0)) }
        val (_,controller)=loggedIn(api)
        controller.loadDaily("2026-10-22"); advanceUntilIdle()
        controller.saveJournal("2026-10-22",entry(energy=2))
        controller.logout(); advanceUntilIdle()
        assertNull(controller.state.value.daily)
        assertNull(controller.state.value.session)
    }
}
