
import type { DataOptions, DataOptionsMap, DataType, DataValues } from "@action-types";
import type { WorkerConfig, NodeChain, SandboxError, Execution } from "@worker-types";

const dangerousKeys = ['__proto__', 'constructor', 'prototype'];

export function* SequentialId() {
    let n = 0;
    while (true) {
        yield ++n;
        if (n + 1 == Number.MAX_SAFE_INTEGER - 1)
            n = 0
    }
    return n
}

export function mergeConfig(source: Record<string, any>, target: Record<string, any>) {

    if (!source) return // nothing to merge

    for (const key in source) {
        if (dangerousKeys.includes(key)) continue;
        if (
            Object.prototype.hasOwnProperty.call(source, key) &&
            source[key] instanceof Object &&
            !Array.isArray(source[key]) &&
            key in target &&
            target[key] instanceof Object &&
            !Array.isArray(target[key])
        ) {
            mergeConfig(source[key], target[key]);
        } else {
            target[key] = source[key];
        }
    }
}

export function updateChains(config: WorkerConfig) {
    const nodeChains = new Map<string/* nodeId */, NodeChain>()

    //Create all chains
    if (config.nodes && typeof config.nodes == 'object') {
        for (const nodeId in config.nodes) {
            nodeChains.set(nodeId, { id: nodeId })
        }
    }

    if (Array.isArray(config.chains)) {
        // Chain format: nodeId:handle>nodeId:handle
        for (const chainId of config.chains) {
            const [source, target] = chainId.split('>')
            const [sourceNodeId, sourceHandle] = source.split(':')
            const [targetNodeId, targetHandle] = target.split(':')
            if (!nodeChains.has(sourceNodeId)) {
                console.warn(`Missing nodeId ${sourceNodeId} on chain ${chainId}`)
                continue
            }
            if (!nodeChains.has(targetNodeId)) {
                console.warn(`Missing nodeId ${targetNodeId} on chain ${chainId}`)
                continue
            }
            let sourceChain = nodeChains.get(sourceNodeId)
            let targetChain = nodeChains.get(targetNodeId)

            if (!sourceChain.next)
                sourceChain.next = new Map()

            if (!targetChain.prev) {
                targetChain.prev = new Map()
                targetChain.prevMaxStack = 1
            }

            if (!sourceChain.next.has(sourceHandle))
                sourceChain.next.set(sourceHandle, [])

            if (!targetChain.prev.has(targetHandle))
                targetChain.prev.set(targetHandle, [])

            sourceChain.next.get(sourceHandle).push([targetChain, targetHandle, chainId])
            targetChain.prev.get(targetHandle).push([sourceChain, sourceHandle, chainId])
        }
    }

    // Calculate highest stacked-input
    nodeChains.forEach(chain => {
        chain.prev?.forEach(chains => {
            if (chains.length > chain.prevMaxStack)
                chain.prevMaxStack = chains.length
        })
    })

    return nodeChains
}

export function isSandboxError(obj: any): obj is SandboxError {
    const key: keyof SandboxError = '$ERR'
    return !!obj && typeof obj == 'object' && key in obj
}

export function sandboxError(error: any): SandboxError {
    if (error instanceof Error) {
        return {
            $ERR: error.name,
            message: error.message,
            stack: error.stack,
        } as SandboxError
    } else if (isSandboxError(error)) {
        return error
    }
    else {
        console.warn('[KERNEL]', 'UNKNOWN ERROR', error)
        return { $ERR: 'unknown', message: `${error}` }
    }
}

export function sandboxToError(s: SandboxError): Error {
    const err = new Error(s.message)
    err.name = s.$ERR || 'Error'
    err.stack = s.stack
    return err
}

export function validateProduces(producer: DataOptionsMap, produces: DataValues<DataOptions>) {
    if (!producer) {
        // Node may have been removed
        return 'Producer not found'
    }
    if (!produces) {
        return 'Not producing anything'
    }
    if (typeof produces != 'object') {
        return 'Producing invalid data'
    }
    const errors = []
    for (const [key, data] of producer) {
        if (key in produces) {
            if (!isValidDataType(data.type, produces[key])) {
                errors.push(`${key} is not valid ${data.type}`)
            }

        } else if (data.required) {
            errors.push(`Not producing "${key}"`)
        }
    }
    if (errors.length)
        return errors.join(", ") + '.'
    return true
}


function isValidDataType(type: DataType, value: any) {
    switch (type) {
        case 'BINARY':
        case 'MESSAGE':
            if (typeof value != 'object')
                return false
        // Fall through here
        case 'ANY':
            return value !== undefined && value !== null

        case 'TEXT':
            return typeof value == 'string'
    }
}