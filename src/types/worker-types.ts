import type { WsRemoteApiRet } from "@remote-types";
import type { PendingExecution } from "../runner/worker/pending-execution";
import type { ConfigOptions, ConfigValues, DataOptions, DataValues } from "./action-types"
import type { MsgPayload } from "@apps-types";

export type SandboxRunParam = {
    /** KernelProcess.id */
    pid: number
    /** ExecutionID */
    eid: number
    nodeId: string
    // config: ConfigValues<ConfigOptions>
    consumes: DataValues<DataOptions>
}

export type SandboxRunResult = DataValues<DataOptions> | SandboxError
export type SandboxError = {
    $ERR: string
    message: string
    stack?: string
}

export type Executor = (param: SandboxRunParam) => Promise<SandboxRunResult>

export type DeepPartial<T> = T extends object ? {
    [P in keyof T]?: DeepPartial<T[P]>;
} : T;


/** 
 * WS to Worker and Worker to Sandbox messages
 */
export type WorkerCmdParams = {
    exit: { in: undefined, out: null },
    /** Execute single node. */
    run: { in: SandboxRunParam, out: SandboxRunResult },
    /** Start kernel */
    kernel: { in: boolean, out: boolean },
    /** Truncate history log file */
    clearHistory: { in: undefined, out: boolean },
    /** Start workflow in kernel. by pushing a msg. This is not have reply. */
    push: { in: MsgPayload, out: null },
    /** Update config using deep merge. */
    patchConfig: { in: DeepPartial<WorkerConfig>, out: null }
    replaceConfig: { in: WorkerConfig, out: null }
    // WS Debug panel to watch runner console
    subscribeConsole: { in: undefined, out: any },
    unsubscribeConsole: { in: undefined, out: any },
    // WS Debug panel to watch push msg events from Remote WA
    subscribePush: { in: undefined, out: any },
    unsubscribePush: { in: undefined, out: any },
    clearLog: { in: undefined, out: any },
    /** Indicate that current Ws is From Whatsapp Web Remote */
    remote: { in: boolean, out: any },
    api: { in: WsRemoteApiRet, out: any },
    
}

/** Runner to Worker messages */
export type WorkerMessageMap = {
    [K in keyof WorkerCmdParams]: {
        request: {
            jobId: number
            cmd: K,
            param: WorkerCmdParams[K]['in']
        }
        response: {
            jobId: number
            result: WorkerCmdParams[K]['out']
        }
    }
}

export type WorkerMessage = WorkerMessageMap[keyof WorkerMessageMap]

export type Node<T extends ConfigOptions = ConfigOptions> = {
    actionId: string,
    config: ConfigValues<T>
}
/** Node Object */
export type Nodes = Record<string/* node ID */, Node>

export type NodeChain = {
    /** NodeId */
    id: string
    // consumes: string[]
    // mustConsumes?: string[]
    next?: Map<string/* handle */, [NodeChain, string/* handle */, string/* chaindId */][]>
    prev?: Map<string/* handle */, [NodeChain, string/* handle */, string/* chaindId */][]>
    /** Highest number the edges that receive multiple sources */
    prevMaxStack?: number
}
export type NodeChains = Map<string/* nodeId */, NodeChain>
// export type NodeLayers = NodeChain[][]
export interface WorkerConfig {
    // session: SessionConfig
    nodes?: Nodes
    /**
     * Chain format: nodeId:handle>nodeId:handle
     */
    chains?: Array<string>
}

export type Execution<T extends ConfigOptions = ConfigOptions> = {
    /** Execution ID */
    id: number
    /** Kernel process ID */
    pid: number
    // nodeId: string
    node: NodeChain
    chains: string[]
    consumesMap: WeakMap<NodeChain, [string/* src */, string/* target */][]>
    configs: ConfigValues<T>,
    consumes: DataValues<DataOptions>
    produces?: DataValues<DataOptions>

    /** timestamp */
    start: number
    end?: number
    error?: SandboxError
}


export type KernelProcess = {
    id: number
    hasError?: boolean
    data: DataValues<DataOptions>
    executions: Execution[]
    pendingStacks: WeakMap<NodeChain, PendingExecution>
    /** Absolute timestamp from Date.now() */
    ts: number
    /** Relative from perfomance.now() */
    start: number
    /** Relative from perfomance.now() */
    end: number
}