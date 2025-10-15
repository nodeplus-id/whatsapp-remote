import type { FlowExportObject } from "@vue-flow/core";
import Session from "./session";
import { type SessionConfig, SessionState, WsData } from "../types";
import SessionsStorage from "./storage/sessions.storage";
import { WS } from "../server/listeners";
import { processServer } from "../runner-controller";
import type { WorkerConfig } from "@worker-types";
import { slugify, vueflowToWorkflowConfig } from "../utils/shared";

export class Manager {
    private db = new SessionsStorage()
    sessions: Map<number, Session> = new Map()
    private sessionWorkers: Map<number, string[]> = new Map()
    private runnerController = processServer

    constructor() {
        this.db.data.configs.forEach(cfg => this.addSession(cfg))
        processServer.onWorkerStoped = this.onWorkerStoped
    }

    async init() {
        const promises = []
        // await import("../workflow/runner-controller").then(({ processServer }) => {
        //     this.runnerController = processServer
        // })

        for (const [i, session] of this.sessions) {
            if (!session.config.autoStart) continue
            console.debug(`Autostarting session: ${session.config.name}`)
            promises.push(session.start().catch(err => {
                console.error(`Autostarting session: ${session.config.name} FAILED.`, err)
            }))
        }
        return Promise.all(promises)
    }


    async forceResetState(sessionId: number) {
        const session = this.sessions.get(sessionId)
        if (!session) return
        if (session.state != SessionState.stopped) {
            await this.stop(sessionId).catch(() => { })
        }
        this.db.forceResetState(sessionId)
        session.state = SessionState.stopped
        this.db.save()
    }

    private addSession(cfg: SessionConfig) {
        const session = new Session(cfg)
        this.sessions.set(cfg.id, session)
    }

    getWorkflowData(sessionId: number) {
        if (!this.sessions.has(sessionId)) {
            return
        }
        return this.db.data.workflows.find(v => v.sessionId === sessionId)
    }

    private onWorkerStoped = (name: string) => {
        let idx: number
        for (const [_sessionId, workers] of this.sessionWorkers) {
            idx = workers.indexOf(name)
            if (idx >= 0) {
                workers.splice(idx, 1)
                // Broadcast
                WS.broadcast({ active_workers: [...this.sessionWorkers.values()].flat(1) })
                return
            }
        }
        console.warn(`[MANAGER] No worker with name "${name}" to be removed.`)
    }

    getRunner() {
        return {
            runnerType: 'embeded', // may be 'remote' in the future.
            endpoint: this.runnerController.getEndpoint()
        }
    }

    getActiveWorker(sessionId: number) {
        const session = this.sessions.get(sessionId)
        if (!session) {
            throw new Error(`SessionId not found`)
        }
        const workerName = slugify(session.config.name)
        const workers = this.sessionWorkers.get(sessionId) || []

        if (workers.includes(workerName)) {
            const url = this.runnerController.getWorkerWsUrl(workerName)
            return { workerName, url }
        } else {
            throw new Error('Worker not found')
        }
    }
    getOrCreateWorker(sessionId: number, workerName: string, workerConfig?: WorkerConfig) {
        if (!this.sessions.has(sessionId)) {
            throw new Error(`SessionId not found`)
        }

        const workers = this.sessionWorkers.get(sessionId) || []

        if (workers.includes(workerName)) {
            const url = this.runnerController.getWorkerWsUrl(workerName)
            return Promise.resolve({ workerName, url })
        }
        return this.createWorker(sessionId, workerName, workerConfig)
    }

    createWorker(sessionId: number, workerName: string, workerConfig?: WorkerConfig) {
        if (!this.sessions.has(sessionId)) {
            throw new Error(`SessionId not found`)
        }

        const workers = this.sessionWorkers.get(sessionId) || []

        if (workers.includes(workerName)) {
            throw new Error(`Worker name "${workerName}" already exists in sessionId ${sessionId}`)
        }

        if (!this.sessionWorkers.has(sessionId))
            this.sessionWorkers.set(sessionId, [])

        return this.runnerController.ipcSend('startWorker', [workerName, workerConfig, { wsTimeoutSecond: 10 }])
            .then(res => {
                this.sessionWorkers.get(sessionId).push(res.name)
                // Broadcast
                WS.broadcast({ active_workers: [...this.sessionWorkers.values()].flat(1) })
                const url = this.runnerController.getWorkerWsUrl(res.name)
                return { workerName, url }
            })
    }

    getOrCreateWorkerDebugger(sessionId: number) {
        if (!this.sessions.has(sessionId)) {
            throw new Error(`SessionId not found`)
        }
        const session = this.sessions.get(sessionId)!
        const workerName = `${slugify(session.config.name)}-tester`
        if (this.sessionWorkers.has(sessionId) &&
            this.sessionWorkers.get(sessionId).includes(workerName)) {
            const url = this.runnerController.getWorkerWsUrl(workerName)
            return Promise.resolve({ workerName, url })
        } else {
            return this.createWorker(sessionId, workerName, undefined)
        }
    }

    /** Set "the current" workflow data */
    setWorkflowData(sessionId: number, data: FlowExportObject, versionName?: string) {
        const session = this.sessions.get(sessionId)
        if (!session) return

        let workflow = this.db.data.workflows.find(v => v.sessionId === sessionId)
        // todo: save history?
        if (workflow) {
            workflow.flow = data
            // set to active worker too
            try {
                // Check if worker active
                const { workerName } = this.getActiveWorker(sessionId)
                const workerConfig = vueflowToWorkflowConfig(data)
                this.runnerController.ipcSend('updateWorkerConfig', [workerName, workerConfig])
                    .then(() => {
                        console.debug(`[MANAGER] worker "${workerName}" config updated`)
                    }).catch(
                        e => console.warn(`[MANAGER] worker "${workerName}" fail update config`, e.message || e)
                    )
            } catch (error) { /* Just ignore */ }

        } else {
            workflow = this.db.createWorkflow(sessionId, data, versionName)
            this.db.data.workflows.push(workflow)
        }
        this.db.save()
        return workflow
    }

    getDbAndStates() {
        const data: WsData = {
            db: this.db.data,
            session_states: [],
            wa_states: [],
            active_workers: [...this.sessionWorkers.values()].flat(1),
            runner_workers_endpoints: this.runnerController.getEndpoint()
        }
        for (const [id, session] of this.sessions.entries()) {
            data.session_states.push([id, session.state])
            data.wa_states.push([id, session.waStates])
        }
        return data
    }

    async patchConfig(id: number, config: Partial<SessionConfig>) {
        const ses = this.sessions.get(id)
        if (!ses) return
        Object.assign(ses.config, config)
        this.db.save()
        WS.broadcast(this.getDbAndStates())
        return ses.config
    }

    getSessionMergedConfig(id: number) {
        const ses = this.sessions.get(id)
        if (!ses) return
        return ses.getMergedConfig()
    }

    /** Create a new Whatsapp Web session */
    create() {
        const item = this.db.createSession()
        this.addSession(item)
        return item
    }

    async delete(id: number) {
        const ses = this.sessions.get(id)
        if (!ses) return
        if (ses.state != SessionState.stopped) {
            await this.stop(id)
        }
        this.db.deleteSession(id)
    }

    async start(id: number) {
        const ses = this.sessions.get(id)
        if (!ses) {
            throw new Error(`Session id: ${id} not found`)
        }

        if (ses.state != SessionState.stopped) {
            throw new Error(`Already: ${SessionState[ses.state]}`)
        }

        return ses.start()
    }

    async stop(id: number) {
        const ses = this.sessions.get(id)
        if (!ses) {
            throw new Error(`Session id: ${id} not found`)
        }

        if (ses.state == SessionState.stopped) {
            throw new Error(`Already: ${SessionState[ses.state]}`)
        }

        return ses.stop()
    }

    async link(id: number, phone: string) {
        const ses = this.sessions.get(id)
        if (!ses) {
            throw new Error(`Session id: ${id} not found`)
        }

        if (ses.state != SessionState.need_auth) {
            throw new Error(`State is: ${SessionState[ses.state]}`)
        }

        return ses.pairing(phone)
    }

    async close() {
        for (const ses of this.sessions.values()) {
            ses.stop()
        }
        this.runnerController.ipcSend('destroy', [])
    }

}

export const MANAGER = new Manager()
