<template>
    <div class="d-flex flex-column fill-height">
        <div class="d-flex align-center ga-2 px-2">
            <WsIndicator :state="state.ws" />
            <div class="pa-1">
                <h3>Tester</h3>
            </div>
            <v-spacer />
            <v-chip variant="elevated" color="grey" v-if="session?.lastWaWebVersion" size="small">
                v{{ session?.lastWaWebVersion }}
            </v-chip>
            <SessionStates :session="session" />
        </div>
        <v-divider />
        <v-row no-gutters class="h-100" style="flex-wrap: nowrap;overflow-y: auto;">
            <v-col sm="6" class="d-flex flex-column">
                <div class="d-flex align-center ga-2 px-2">
                    <v-switch :disabled="!canListenRealEvent" v-model="listenEvent"
                        :color="listenEvent ? 'success' : 'default'" hide-details label="Listen Real Events" />
                    <VSpacer />
                    <v-btn-group variant="outlined" density="compact" divided>
                        <v-btn @click="onTriggerManual" :disabled="!eventData" size="small" color="primary"
                            prepend-icon="bolt">Start</v-btn>
                        <EventDataDialog v-model="eventData" v-slot="{ props, isActive }">
                            <v-btn v-bind="props" :active="isActive" size="small" prepend-icon="edit">Data</v-btn>
                        </EventDataDialog>
                    </v-btn-group>
                </div>

                <KernelProcessList v-model="selectedHistory" style="flex: 1 1 auto;overflow-y: auto;" ref="history" />
            </v-col>
            <v-divider vertical />
            <v-col sm="6" class="d-flex flex-column">
                <WorkerLogViewer style="flex: 1 1 auto; min-height: 0px;" v-if="!!logUrl" ref="logViewer"
                    :worker-name="kernelDebug.workerName" :log-url="logUrl" />
            </v-col>
            <!-- <v-divider vertical />
            <v-col>

            </v-col> -->
        </v-row>
    </div>
</template>
<script setup lang="ts">
import { computed, markRaw, onBeforeUnmount, ref, shallowRef, watch, watchEffect, type ShallowRef } from 'vue'
import type { SessionItem } from '../../../uses/sessions'
import { WsState } from '../../../uses/ws-api'
import WsIndicator from '../../../components/WsIndicator.vue'
import { popup } from '../../../components/Popups.vue'
import EventDataDialog from './EventDataDialog.vue'
import { KernelDebug } from './KernelDebug'
import { sampleMessageEvent } from '../../../uses/storage'
import { SessionState } from '@src/types'
import { useVueflowExtractor } from '../../../uses/vueflow-extractor'
import KernelProcessList from './KernelProcessList.vue'
import SessionStates from '../../../components/SessionStates.vue'
import WorkerLogViewer from '../../../components/WorkerLogViewer.vue'
import { useKernelDebugFlow } from './KernelDebugFlow'
import { useVueFlow } from '@vue-flow/core'
import type { KernelProcess } from '@src/types/worker-types'
import { useListenMsgEvents } from './useListenMsgEvent'

const props = defineProps<{ session: SessionItem }>()
const eventDataKey = `debug-event-data-${props.session?.id}`
const eventData = ref<string>(localStorage.getItem(eventDataKey) || JSON.stringify(sampleMessageEvent, null, 2))
const listenEvent = ref(false)
const logViewer = shallowRef<InstanceType<typeof WorkerLogViewer>>()
// const workerName = ref('')
const isWorkerActive = ref(false)
const history = shallowRef<InstanceType<typeof KernelProcessList>>()

let realEventListener: ShallowRef<Awaited<ReturnType<typeof useListenMsgEvents>> | 'request' | null> = shallowRef(null)

const state = {
    ws: ref(WsState.disconnected)
}

const { nodes, findNode } = useVueFlow(props.session.id.toString())
const extractor = useVueflowExtractor(props.session.id.toString())
const debugFlow = useKernelDebugFlow(props.session.id)

let kernelDebug = new KernelDebug(props.session.id, state.ws)
let updateConfigTimer: any = 0
let updateConfigInProgess = ref(0)
let selectedHistory = ref<number>(0)
const displayedProcess = new WeakMap<KernelProcess, { autoHide: boolean }>()
const logUrl = ref<string>()

kernelDebug.onConsole = (line) => logViewer.value?.add(line)
watch(listenEvent, (v) => {

    if (realEventListener.value == 'request') return

    if (v) {
        if (realEventListener.value) return
        useListenMsgEvents(props.session.id, (msg) => {
            kernelDebug.startWorkflow(msg)
        }).then((v) => realEventListener.value = v)
    } else {
        if (realEventListener.value) {
            realEventListener.value.off()
            realEventListener.value = null
        }
    }
})
watch(selectedHistory, (pid, old) => {
    if (old) {
        const pOld = history.value?.get(old)
        if (pOld
            && displayedProcess.has(pOld)
            && !displayedProcess.get(pOld)?.autoHide
        ) {
            displayedProcess.delete(pOld)
            hideExecHistory(pOld)
        }
    }
    const p = history.value?.get(pid)
    if (!p) return
    if (displayedProcess.has(p)) {
        displayedProcess.get(p)!.autoHide = false
        console.debug('Already displayed pid', p.id)
        return
    }
    displayedProcess.set(p, { autoHide: false })
    showExecHistory(p)
})

function showExecHistory(p: KernelProcess) {
    for (const exec of p.executions) {
        const node = findNode(exec.node.id)
        if (!node) continue
        const data = debugFlow.value.get(node.data)
        if (!data) return
        let execList = data.get(p.id)
        if (!execList) {
            execList = []
            data.set(p.id, execList)
        }
        execList.push({ exec: markRaw(exec), state: exec.error ? 'err' : 'ok' })
    }
}

function hideExecHistory(p: KernelProcess) {
    nodes.value.forEach(node => {
        const data = debugFlow.value.get(node.data)
        if (!data) return
        data.get(p.id)?.splice(0)
        data.delete(p.id)
    })
}
// todo: not work like expected
function clearExecHistory() {
    nodes.value.forEach(node => {
        const data = debugFlow.value.get(node.data)
        if (!data) return
        for (const execlist of data.values()) {
            execlist.splice(0)
        }
        data.clear()
    })
}

kernelDebug.on('start', (p) => {
    history.value?.inProgress.add(p.id)
    nodes.value.forEach(node => {
        debugFlow.value.get(node.data)?.set(p.id, [])
    })
    displayedProcess.set(p, { autoHide: true })
})

kernelDebug.on('end', (p) => {
    history.value?.inProgress.delete(p.id)
    history.value?.add(p)
    setTimeout(() => {
        if (displayedProcess.get(p)?.autoHide === true) {
            displayedProcess.delete(p)
            hideExecHistory(p)
        }
    }, 10e3)
})
kernelDebug.on('execStart', (exec) => {
    const node = findNode(exec.node.id)
    if (!node) return console.warn(`[e1] Node Notfound ${exec.node.id}`)
    let execList = debugFlow.value.get(node.data)?.get(exec.pid)
    if (!execList) {
        console.warn('No execList, race condition?')
        execList = []
        debugFlow.value.get(node.data)?.set(exec.pid, execList)
    }
    execList.push({ exec: markRaw(exec), state: 'run' })
})
kernelDebug.on('execEnd', exec => {
    const node = findNode(exec.node.id)
    if (!node) return console.warn(`[e2] Node Notfound ${exec.node.id}`)
    const pid = exec.pid
    let execList = debugFlow.value.get(node.data)?.get(pid)
    if (!execList) return
    const found = execList.find(v => v.exec.id == exec.id)
    if (found) {
        found.state = exec.error ? 'err' : 'ok'
    }
})

kernelDebug.start()
    .then(() => logUrl.value = kernelDebug.getLogUrl())
    .catch(err => popup(err.message || err, 'error'))

watchEffect(() => {
    localStorage.setItem(eventDataKey, eventData.value || '')
})

function onTriggerManual() {
    kernelDebug.startWorkflow(JSON.parse(eventData.value))
}

const canListenRealEvent = computed(() => {
    return realEventListener.value != 'request'
        && props.session.state.value > SessionState.starting
})

onBeforeUnmount(() => {
    kernelDebug.stop()
    extractor.stop()
    clearExecHistory()
    if (realEventListener.value && typeof realEventListener.value == 'object') {
        realEventListener.value!.off()
        realEventListener.value = null
    }
})

const updateConfigDebouncer = (delay = 500) => {
    clearTimeout(updateConfigTimer)
    updateConfigTimer = setTimeout(() => {
        // if( updateConfigInProgess )
        updateConfigInProgess.value++
        kernelDebug?.updateConfig(extractor.config.value)
            .finally(() => updateConfigInProgess.value--)
    }, delay)
}

watchEffect(() => {
    switch (state.ws.value) {
        case WsState.disconnected:
            isWorkerActive.value = false
            break

        case WsState.connected:
            isWorkerActive.value = true
            if (!!extractor.config.value)
                updateConfigDebouncer(100)
            break
    }
})


</script>