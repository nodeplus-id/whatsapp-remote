/*
 * Function in this file must be runnable in Browser and NodeJS 
 */

import type { FlowExportObject, Node } from "@vue-flow/core";
import type { WorkerConfig, WorkerMessageMap } from "@worker-types";
import type { ActionNodeData } from "../types/action-types";
import type { WebSocket as NodeWebSocket } from "ws";

export function slugify(text: string) {
    return text
        .toString()                     // Ensure string
        .normalize('NFKD')              // Normalize accents
        .replace(/[\u0300-\u036f]/g, '') // Remove accents
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '')   // Remove non-alphanum
        .replace(/\s+/g, '-')           // Replace spaces with -
        .replace(/-+/g, '-')            // Collapse multiple -
}

export function vueflowToWorkflowConfig(data: Pick<FlowExportObject, 'nodes' | 'edges'>): WorkerConfig {

    if (!data) return {}

    const nodes: WorkerConfig['nodes'] = {}
    const chains: WorkerConfig['chains'] = []

    data.nodes?.forEach((node: Node<ActionNodeData>) => {
        nodes[node.id] = {
            actionId: node.data?.id,
            config: node.data?.config
        }
    })

    data.edges?.forEach((edge) => {
        chains.push(`${edge.source}:${edge.sourceHandle}>${edge.target}:${edge.targetHandle}`)
    })

    return { nodes, chains }
}

export function workerClientConnector(ws: WebSocket | NodeWebSocket) {
    let reqId = 0
    const requests = new Map<string, [Function, Function]>()

    const handleMessage = (msg: [string, any]) => {
        if (!Array.isArray(msg))
            throw new Error('Not array message')
        if (msg.length != 2)
            throw new Error(`Array length ${msg.length}`)

        const [id, result] = msg
        if (!requests.has(id))
            return console.warn(`Websocket: Id not handled`, msg)
        requests.get(id)[0](result)
        requests.delete(id)
    }

    const stop = () => {
        const err = new Error(`WS Closed`)
        requests.forEach(v => v[1](err))
        requests.clear()
    }

    if ('on' in ws) { // NodeJS World
        ws.on('message', (data, isBinary) => {
            if (isBinary) return
            try {
                handleMessage(JSON.parse(data.toString('utf8')))
            } catch (error) {
                console.debug(data)
                console.warn('WS Node Err', error)
            }
        })
        ws.once('close', stop)
    } else {
        ws.addEventListener('message', (e) => {
            try {
                handleMessage(JSON.parse(e.data))
            } catch (error) {
                console.warn('WS Err', error)
            }
        })
        ws.addEventListener('close', stop)
    }

    function send<T extends keyof WorkerMessageMap>(cmd: T, args?: WorkerMessageMap[T]['request']['param']): Promise<WorkerMessageMap[T]['response']['result']> {
        const id = `${++reqId}`

        // Reset counter
        if (reqId >= Number.MAX_SAFE_INTEGER)
            reqId = 0

        return new Promise((r, j) => {
            requests.set(id, [r, j])
            ws.send(JSON.stringify([id, cmd, args]))
        })
    }

    return { send }
}