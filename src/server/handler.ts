import { json, Request, static as expressStatic } from "express"
import type { FlowExportObject } from "@vue-flow/core"
import config from "../config"
import { APP, WS } from "./listeners"
import path from "node:path"
import { allowAllCors } from "../utils/expressjs"
import { actionsMap } from "../workflow/action-map"
import { MANAGER } from "../remote/manager"

// send initail DB config on new WS client
WS.onNewClient.push((ws) => {
    ws.sendData(MANAGER.getDbAndStates())
})

// GET Backend loaded config
APP.get('/cfg', (_req, res) => {
    res.json(config)
})

APP.get('/actions', (_req, res) => {
    const actions = [...actionsMap.options.entries()].map(
        ([_name, info]) => info
    )
    res.json(actions)
})

APP.patch('/workflow/:id', json(), (req, res) => {
    const id = parseInt(req.params.id)
    res.json(MANAGER.setWorkflowData(id, req.body as FlowExportObject))
})

APP.get('/workflow/:id', (req, res) => {
    const id = parseInt(req.params.id)
    res.json(MANAGER.getWorkflowData(id) || {})
})

APP.get('/worker/:sessionId', async (req, res) => {
    const sessionId = parseInt(req.params.sessionId)
    res.json(MANAGER.getActiveWorker(sessionId))
})
APP.get('/worker-debug/:sessionId', async (req, res) => {
    const sessionId = parseInt(req.params.sessionId)
    res.json(await MANAGER.getOrCreateWorkerDebugger(sessionId))
})

APP.get('/session/:id/merged-config', json(), async (req, res) => {
    const id = parseInt(req.params.id)
    res.json(await MANAGER.getSessionMergedConfig(id))
})

APP.patch('/session/:id', json(), async (req, res) => {
    const id = parseInt(req.params.id)
    res.json(await MANAGER.patchConfig(id, req.body))
})

APP.get('/create', async (req, res) => {
    res.send(MANAGER.create())
    WS.broadcast(MANAGER.getDbAndStates())
})

APP.get('/start/:id', async (req, res) => {
    res.send(await MANAGER.start(parseInt(req.params.id)))
})

APP.get('/reset-state/:id', async (req, res) => {
    res.send(await MANAGER.forceResetState(parseInt(req.params.id)))
})

APP.get('/stop/:id', async (req, res) => {
    res.send(await MANAGER.stop(parseInt(req.params.id)))
})

APP.get('/link/:id/:phone', async (req, res) => {
    res.send(await MANAGER.link(parseInt(req.params.id), req.params.phone))
})

APP.delete('/delete/:id', async (req, res) => {
    res.send(await MANAGER.delete(parseInt(req.params.id)))
    WS.broadcast(MANAGER.getDbAndStates())
})

//Remote & Streaming
WS.handler.set('remote-start', (ws, id: number, cfg: any) => {
    const session = MANAGER.sessions.get(id)
    if (!session) return
    session.screenShareStart(ws)
})
WS.handler.set('remote-stop', (ws, id: number, cfg: any) => {
    const session = MANAGER.sessions.get(id)
    if (!session) return
    session.screenShareStop(ws)
})

APP.use((err, req, res, next) => {
    console.warn('[HTTP WRAP-ERROR]', err); // Log the error for debugging
    res.status(500).send({ error: err.message || err }); // Send a generic error response to the client
})

if (config.isLiveDev) {
    await import("./handler-vite")
} else { // Production mode
    const webRoot = path.resolve(import.meta.dirname, '../client')
    // Serve static files from the "public" directory
    APP.use(allowAllCors, expressStatic(webRoot));

    // SPA
    APP.get('/{*all}', (req, res) => {
        const indexPath = path.join(webRoot, 'index.html')
        res.sendFile(indexPath)
    })
}