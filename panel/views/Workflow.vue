<script setup lang="ts">
import { nextTick, ref, shallowRef, watch } from 'vue'
import { waitSessions, type SessionItem } from '../uses/sessions';
import WsIndicator from '../components/WsIndicator.vue';
import ThemeSwitcher from '../components/ThemeSwitcher.vue';
import SessionButtons from '../components/SessionControls.vue';
import FlowEditor from './workflow/FlowEditor.vue';
import { VOverlay, type VMain } from 'vuetify/components';
import Actions from './workflow/ActionList.vue';
import type { FlowExportObject } from '@vue-flow/core';
import type { WorkflowData } from '../../src/types';
import { popup } from '../components/Popups.vue';
import { useWsApiState } from '../uses/ws-api';
import type { BreadcrumbItem } from 'vuetify/lib/components/VBreadcrumbs/VBreadcrumbs.mjs';
import Breadcrumbs from '../components/Breadcrumbs.vue';
import ActiveWorkflowsIndicator from '../components/ActiveWorkflowsIndicator.vue';
import type { ActionOptionItem } from '@src/types/action-types';

const { id } = defineProps<{ id: string }>()
const wsState = useWsApiState()

async function loadSession() {
  const sessionId = parseInt(id)
  const [sessions, data] = await Promise.all([
    waitSessions(),
    fetch(`/workflow/${id}`).then<WorkflowData>(r => r.json())
  ])

  const state = Object.assign(data, { session: sessions.value.get(sessionId) })
  session.value = state.session
  workflow.value = data.flow || {} as any
  return state
}

const session = shallowRef<SessionItem>()
const workflow = shallowRef<FlowExportObject>()

await loadSession()

watch(() => id, async () => {
  console.debug('porp', id)
  await loadSession()
})

const breadcrumbs: BreadcrumbItem[] = [
  {
    title: 'Home',
    to: { name: 'home' }
  },
  {
    title: 'Session: ' + session.value?.name || '...',
    to: {
      name: 'session',
      params: { id }
    }
  }, {
    title: 'Workflows'
  }
]

const mainWrapper = shallowRef<InstanceType<typeof VMain>>()
const flowEditor = shallowRef<InstanceType<typeof FlowEditor>>()

const addActionsDialog = ref(false)

function doAddAction(action: ActionOptionItem) {
  flowEditor.value?.createNode(action)
  addActionsDialog.value = false
}

function doSave(flow: FlowExportObject) {
  fetch(`/workflow/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(flow)
  }).then(res => res.json())
    .then((data: WorkflowData) => {
      workflow.value = data.flow
      popup('Saved')
    }).catch(e => popup(e.message || 'Failed', 'error'))
}
</script>

<template>
  <v-app-bar app density="compact">
    <Breadcrumbs :items="breadcrumbs" />
    <v-spacer></v-spacer>
    <SessionButtons v-if="session" :session="session" />
    <div class="ml-2 d-flex ga-1 align-center">
      <template v-if="session?.account">
        <v-chip size="small">{{ session?.account.user }}</v-chip>
        <v-chip size="small">{{ session?.account.name }}</v-chip>
        <v-avatar color="grey-lighten-1" size="24" class="ml-2 mr-1">
          <v-img v-if="session?.account?.image" :src="session?.account.image"></v-img>
          <v-icon v-else icon="person" />
        </v-avatar>
      </template>
      <ActiveWorkflowsIndicator />
      <WsIndicator :state="wsState.state" size="24" />
      <ThemeSwitcher size="32" />
    </div>
  </v-app-bar>
  <v-main ref="mainWrapper" class="d-flex h-100 flex-column">
    <!-- Main Content -->
    <div class="w-100 fill-height position-relative">
      <FlowEditor @add="addActionsDialog = true" :flow="workflow!" @save="doSave" ref="flowEditor" v-if="session"
        :session="session" />

      <v-overlay v-model="addActionsDialog" contained class="align-center justify-center">
        <Actions @item-click="doAddAction" @drag-start="nextTick(() => addActionsDialog = false)" />
      </v-overlay>
    </div>
  </v-main>
</template>
