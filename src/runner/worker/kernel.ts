import type { Executor, WorkerConfig, NodeChain, NodeChains, Execution, KernelProcess } from "@worker-types";
import type { ActionOptionItem, DataOptions, DataOptionsMap, DataValues } from "@action-types";
import type { ActionOptionsMap } from "../../types/action-types";
import type { MsgPayload } from "@apps-types";
import type { MapValue } from "@helper-types";
import { PendingExecution } from "./pending-execution";
import { isSandboxError, sandboxError, updateChains, validateProduces } from "./utils";

/**
 * Logic that controlls the workflow execution.
 * This code should be agnostic, can be run on browser too
 */
interface KernelEvent {
    // update: [WorkerConfig]
    start: [KernelProcess]
    end: [KernelProcess]
    execStart: [Execution]
    // execError: [SandboxError, Execution]
    execEnd: [Execution]
}
type KernelEventNames = keyof KernelEvent

export class Kernel {
    rootChain: NodeChain = {
        id: '#root',
        // prevMaxStack: 0,
        next: new Map(),
        // prev: new Map()
    }
    nodeChains: NodeChains
    // nodeLayers: NodeLayers = []
    /** Resolved dynamic producer type for validations */
    consumers = new WeakMap<NodeChain/* nodeId */, DataOptionsMap>()
    producers = new WeakMap<NodeChain/* nodeId */, DataOptionsMap>()
    private lastProcessId = 0
    private lastExecutionId = 0
    private eventMap = new Map<KernelEventNames, Set<(...args: KernelEvent[keyof KernelEvent]) => void>>()

    constructor(
        public config: WorkerConfig,
        private options: ActionOptionsMap,
        public executor?: Executor
    ) {
        // Root chain's produce 'msg' field
        this.producers.set(this.rootChain, new Map([['msg', { type: 'MESSAGE' }]]))
        this.onConfigUpdated()
    }

    on<K extends KernelEventNames>(event: K, fn: (...args: KernelEvent[K]) => void) {
        let set = this.eventMap.get(event);
        if (!set) {
            set = new Set();
            this.eventMap.set(event, set);
        }
        set.add(fn);
    }

    off<K extends KernelEventNames>(event: K, fn: (...args: KernelEvent[K]) => void): void {
        const set = this.eventMap.get(event);
        if (set) {
            set.delete(fn as any);
            if (set.size === 0) this.eventMap.delete(event);
        }
    }

    private emit<K extends KernelEventNames>(event: K, ...args: KernelEvent[K]): number {
        const set = this.eventMap.get(event)
        if (!set?.size) return 0 // No listeners

        // snapshot to avoid mutation issues during emit
        const listeners = Array.from(set);
        for (const l of listeners) l(...args);
        return listeners.length;
    }

    protected clear(event?: KernelEventNames): void {
        if (event === undefined) this.eventMap.clear();
        else this.eventMap.delete(event);
    }

    onConfigUpdated() {
        this.nodeChains = updateChains(this.config)
        this.updateConsumerProducer()

        const rootNext: MapValue<NodeChain['next']> = []
        let chains: MapValue<NodeChain['next']>[number]
        let inputHandle: string,
            chainId: string

        // find heads
        for (const chain of this.nodeChains.values()) {
            // head = not linked with previouse node
            if (chain.prev?.size) continue

            const consumes = this.consumers.get(chain)
            if (consumes.size == 0) {
                console.warn(`[KERNEL] Head nodes but not consuming anything ${chain.id}`, consumes)
                continue
            }

            // Get first input handle to receive `msg`
            inputHandle = consumes.keys().next().value
            chainId = `${this.rootChain.id}:msg>${chain.id}:${inputHandle}`
            chains = [this.rootChain, 'msg', chainId]

            rootNext.push([chain, inputHandle, chainId])

            if (chain.prev) {
                if (chain.prev.has(inputHandle))
                    chain.prev.get(inputHandle).push(chains)
                else
                    chain.prev.set(inputHandle, [chains])
            } else {
                chain.prev = new Map([[inputHandle, [chains]]])
            }
        }
        // Root node produce value in `msg` field
        this.rootChain.next.set('msg', rootNext)
    }

    private updateConsumerProducer() {

        let data: DataOptions
        let nodeChain: NodeChain
        let action: ActionOptionItem

        if (!this.config.nodes || typeof this.config.nodes != 'object')
            return

        for (const [nodeId, node] of Object.entries(this.config.nodes)) {
            action = this.options.get(node.actionId)
            if (!action) {
                console.warn(`[KERNEL] Missing actionId ${node.actionId}`)
                continue
            }

            nodeChain = this.nodeChains.get(nodeId)

            if (typeof action.consumes == 'function') {
                try {
                    data = action.consumes(node.config)
                } catch (error) {
                    console.error('[KERNEL] Bad Node Action', error)
                    data = {}
                }
            } else {
                data = action.consumes
            }
            this.consumers.set(nodeChain, new Map(Object.entries(data)))

            if (typeof action.produces == 'function') {
                data = action.produces(node.config)
            } else {
                data = action.produces
            }
            this.producers.set(nodeChain, new Map(Object.entries(data)))
        }
    }


    /** Workflow process Eg: on msg event */
    async startWorkflow(msg: MsgPayload, customId?: number) {

        if (this.lastProcessId >= Number.MAX_SAFE_INTEGER)
            this.lastProcessId = 0

        const start = performance.now()
        const kernelProcess: KernelProcess = {
            id: customId ?? ++this.lastProcessId,
            data: { msg },
            executions: [],
            pendingStacks: new WeakMap(),
            ts: Date.now(),
            start,
            end: start
        }

        this.emit('start', kernelProcess)

        let currentExecutions = this.prepareNextExecutions(this.rootChain, kernelProcess.data, kernelProcess)
        await this.loopExecutions(currentExecutions, kernelProcess, this.nodeChains)
        kernelProcess.end = performance.now()

        this.emit('end', kernelProcess)
        return kernelProcess
    }

    private validateExecution(exec: Execution) {
        const consumer = this.consumers.get(exec.node)
        const { consumes } = exec
        const errors: string[] = []
        for (const [field, defs] of consumer) {
            if (field in consumes) {
                // todo: Check for Type data fitting
                if (defs.required && consumes[field] === undefined || consumes[field] === null) {
                    errors.push(`Empty required "${field}"`)
                }
            } else if (defs.required) {
                errors.push(`Missing required "${field}"`)
            }
        }
        return errors.length ? errors.join(", ") : true
    }

    private async loopExecutions(currentExecutions: Execution[], kernelProcess: KernelProcess, nodeChains: NodeChains) {

        currentExecutions.forEach(v => this.emit('execStart', v))
        kernelProcess.executions.push(...currentExecutions)

        // Ignore node that have error in preparation stage
        let okOrError: true | string
        const noErrorInputs = currentExecutions.filter(exec => {

            //validate
            okOrError = this.validateExecution(exec)
            if (okOrError == true)
                return true

            exec.error = {
                $ERR: 'ValidationError',
                message: okOrError
            }

            exec.end = performance.now()
            this.emit('execEnd', exec)
            return false
        })

        await Promise.all(noErrorInputs.map(exec => {
            return this.execute(exec).then((exec) => {

                // const chain = nodeChains.get(exec.nodeId)
                // validate the output if we have next chains
                if (!exec.error && exec.node.next) {
                    const producer = this.producers.get(exec.node)
                    const okOrError = validateProduces(producer, exec.produces)
                    if (okOrError !== true) {
                        exec.error = {
                            $ERR: 'ProduceError',
                            message: okOrError
                        }
                    }
                }

                if (exec.error) {
                    // this.emit('execError', exec.error, exec)
                    kernelProcess.hasError = true
                } else if (exec.node.next) {
                    const nextExecutions = this.prepareNextExecutions(exec.node, exec.produces, kernelProcess)
                    this.emit('execEnd', exec)

                    return this.loopExecutions(nextExecutions, kernelProcess, nodeChains)
                }
                this.emit('execEnd', exec)
                return null
            })
        }))
    }

    private prepareNextExecutions(currentChain: NodeChain, data: DataValues<DataOptions>, kernelProcess: KernelProcess) {
        const executions: Execution[] = []
        let pending: PendingExecution

        // todo: Execution flow can be optimized by creating all flow in the begining ?

        for (const [sourceHandle, chains] of currentChain.next) {
            for (const [nextChain, targetHandle, chainId] of chains) {
                if (this.lastExecutionId >= Number.MAX_SAFE_INTEGER)
                    this.lastExecutionId = 0
                // consumesNext = this.consumers.get(nextChain)

                const currentValue = data[sourceHandle]

                // Check if multipe edge sources connected to one node [n > 1]
                const merged = executions.some(v => {
                    if (v.node == nextChain && v.consumesMap.has(currentChain)) {
                        // merge if goes to the same input node
                        v.consumesMap.get(currentChain).push([sourceHandle, targetHandle])
                        v.chains.push(chainId)
                        if (currentValue !== undefined && currentValue !== null)
                            v.consumes[targetHandle] = currentValue
                        return true
                    }
                    return false
                })

                if (merged) continue

                if (nextChain.prev.size == 1) {
                    // if (executions.find(v => v.node === nextChain)) {
                    //     continue
                    // }
                    executions.push({
                        id: ++this.lastExecutionId,
                        pid: kernelProcess.id,
                        chains: [chainId],
                        node: nextChain,
                        configs: this.config.nodes[nextChain.id].config,
                        consumes: { [targetHandle]: currentValue },
                        consumesMap: new WeakMap([[currentChain, [[sourceHandle, targetHandle]]]]),
                        start: performance.now()
                    })
                    continue // next
                }

                // check if one node connected to multiple edges to the same nodeChain [1 > n]
                if (executions.find(v => v.node === nextChain)) {
                    continue
                }

                // if multiple handles are connected
                pending = kernelProcess.pendingStacks.get(nextChain)
                if (!pending) {
                    pending = new PendingExecution(nextChain)
                    kernelProcess.pendingStacks.set(nextChain, pending)
                    // fast break, need to wait other incoming branch
                    console.debug(`[Kernel] ${nextChain.id} from ${currentChain.id} Waiting (NEW)`)
                    // continue
                }

                if (pending.done) {
                    console.debug(`[Kernel] ${nextChain.id} from ${currentChain.id} Waiting ${nextChain.prevMaxStack} (ADD)`)
                    pending.add(nextChain.prevMaxStack)
                }
                pending.provide(currentChain, currentValue)

                const ready = pending.ready()
                if (!ready) {
                    console.debug(`[Kernel] ${nextChain.id} from ${currentChain.id} Still Waiting`)
                    continue
                }
                console.debug(`[Kernel] ${nextChain.id} from ${currentChain.id} Resolved ${ready.length}`)

                if (pending.done) {
                    console.debug(`[Kernel] ${nextChain.id} from ${currentChain.id} DONE`)
                    // kernelProcess.pendingStacks.delete(nextChain)
                }

                executions.push(...ready.map(r => ({
                    ...r,
                    id: ++this.lastExecutionId,
                    pid: kernelProcess.id,
                    node: nextChain,
                    configs: this.config.nodes[nextChain.id].config,
                    start: performance.now()
                })))
            }
        }

        return executions
    }

    /** Never rejected */
    private execute(exec: Execution): Promise<Execution> {
        const param = {
            pid: exec.pid,
            eid: exec.id,
            nodeId: exec.node.id,
            consumes: exec.consumes
        }

        if (!this.executor) {
            exec.error = {
                $ERR: 'KernelError',
                message: 'No kernel executor.'
            }
            return Promise.resolve(exec)
        }

        return this.executor(param).then(res => {
            if (isSandboxError(res)) {
                exec.error = res
            } else if (!res || typeof res != 'object') {
                if (exec.node.next && exec.node.next.size) {
                    exec.error = {
                        $ERR: 'OutputError',
                        message: 'Not produces any data'
                    }
                } // if no next nodes, ignore empty result
            } else {
                exec.produces = res
            }
            return exec
        }).catch((error) => {
            console.warn(`[KERNEL] Internal error:`, error)
            exec.error = sandboxError(error)
            return exec
        }).finally(() => {
            exec.end = performance.now()
        })
    }
}

