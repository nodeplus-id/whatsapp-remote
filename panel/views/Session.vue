<script setup lang="ts">
import { onUnmounted, ref, watchEffect } from 'vue'
import { useSession } from '../uses/sessions';
import WsIndicator from '../components/WsIndicator.vue';
import ThemeSwitcher from '../components/ThemeSwitcher.vue';
import SessionButtons from '../components/SessionControls.vue';
import { useWsApiState } from '../uses/ws-api';
import SessionStates from '../components/SessionStates.vue';
import { watch } from 'vue';
import { useStorage } from '../uses/storage';
import Breadcrumbs from '../components/Breadcrumbs.vue';
import type { BreadcrumbItem } from 'vuetify/lib/components/VBreadcrumbs/VBreadcrumbs.mjs';
import ActiveWorkflowsIndicator from '../components/ActiveWorkflowsIndicator.vue';
import { activeWorkers } from '../uses/ws-runner-api';
import { slugify } from '@src/utils/shared';
import ExecutionLogs from './session/ExecutionLogs.vue';
import WorkerLogViewer from '../components/WorkerLogViewer.vue';

const { defaultConfig } = await useStorage()
const { id } = defineProps<{ id: string }>()
const sessionId = parseInt(id)
const wsState = useWsApiState()
const { session, stop } = await useSession(sessionId)
// Workername is equal with session name. 1 session = 1 worker
const workerName = slugify(session.value.name)
const workflowState = ref<'disabled' | 'enabled' | 'active'>('disabled')
const workflowEnabled = ref(defaultConfig.defaultWorkflowEnabled)
const breadcrumbs: BreadcrumbItem[] = [
    {
        title: 'Home',
        to: { name: 'home' }
    },
    {
        title: 'Session: ' + session.value?.name || '...',
    }
]

watchEffect(() => {
    const enabled = session.value?.workflowEnabled ?? defaultConfig.defaultWorkflowEnabled
    workflowEnabled.value = enabled
    if (activeWorkers.value.includes(workerName)) {
        workflowState.value = 'active'
    } else if (enabled) {
        workflowState.value = 'enabled'
    } else {
        workflowState.value = 'disabled'
    }
})

watch(workflowEnabled, enable => {
    fetch(`/session/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowEnabled: enable })
    })
})

onUnmounted(() => stop())


</script>

<template>
    <v-app-bar app density="compact">
        <Breadcrumbs :items="breadcrumbs" />
        <VSpacer />
        <ActiveWorkflowsIndicator />
        <WsIndicator :state="wsState.state" size="24" />
        <ThemeSwitcher size="32" />
    </v-app-bar>
    <v-main>
        <v-container fluid class="d-flex flex-column pa-6"
            style="overflow-y: auto; height: calc(100vh - var(--v-layout-top))">
            <v-row style="flex: 0 0 auto">
                <v-col cols="12" sm="6" class="d-flex flex-column">
                    <v-card elevation="2" style="flex: 1 1 auto" :loading="!session" :title="session.name">
                        <SessionButtons v-if="session" list-mode :session="session" show-all>
                            <v-list-item :to="{ name: 'workflow', params: { id: sessionId } }" density="compact"
                                class="text-primary" prepend-icon="flowsheet" title="Workflow Editor" />
                        </SessionButtons>
                    </v-card>
                </v-col>
                <v-col cols="12" sm="6" class="d-flex flex-column">
                    <v-card elevation="2" style="flex: 1 1 auto" :loading="!session" title="States">
                        <SessionStates v-if="session" list-mode :session="session" />
                    </v-card>
                </v-col>
            </v-row>
            <v-row style="flex-wrap: nowrap;overflow-y: auto;">
                <v-col cols="12" sm="6" class="d-flex flex-column" style="">
                    <ExecutionLogs :session-id="sessionId" :worker-name="workerName" />
                </v-col>
                <v-col cols="12" sm="6" class="d-flex flex-column">
                    <WorkerLogViewer style="flex: 1 1 auto" :worker-name="workerName" />
                </v-col>
            </v-row>
        </v-container>
    </v-main>
</template>
