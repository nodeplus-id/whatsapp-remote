<template>
    <VDialog v-model="dialog" max-width="800" scrollable @after-leave="currentCfg = null">
        <VCard :loading="!mergedCfg" :title="mergedCfg?.name">
            <VCardText>
                <VRow class="mb-2">
                    <VCol>
                        <v-text-field variant="plain" class="mb-1" hide-details :model-value="currentCfg?.id" label="ID"
                            type="number" readonly />
                        <v-text-field variant="plain" class="mb-1" hide-details :model-value="currentCfg?.dataDir"
                            label="Data Directory" readonly />
                        <v-text-field variant="plain" class="mb-1" hide-details
                            :model-value="currentCfg?.lastWaWebVersion || '&mdash;'" label="WaWeb Version" readonly />
                    </VCol>
                    <VCol v-if="currentCfg?.account">
                        <v-text-field variant="plain" class="mb-1" hide-details :model-value="currentCfg?.account?.user"
                            label="WA Account ID" readonly />
                        <v-text-field variant="plain" class="mb-1" hide-details :model-value="currentCfg?.account?.name"
                            label="WA Account Name" readonly />
                        <v-text-field variant="plain" class="mb-1" hide-details
                            :model-value="`${currentCfg?.account?.platform} (${currentCfg?.account?.device})`"
                            label="WAWeb Platform (Device)" readonly />
                    </VCol>
                </VRow>
                <v-form v-model="valid" @submit.prevent="submit" v-if="mergedCfg">
                    <!-- <v-select :value="currentCfg?.browser" label="Browser" :items="supportedBrowsers" readonly /> -->
                    <v-text-field v-model="mergedCfg.name" @update:modelValue="v => change('name', v)" label="Name"
                        required />
                    <v-text-field v-model="mergedCfg.executablePath"
                        @update:modelValue="v => change('executablePath', v)" label="Chrome Executable Path" />
                    <v-combobox v-model="mergedCfg.args" @update:modelValue="v => change('args', v)" label="Args"
                        multiple chips clearable />
                    <VTextarea :rows="2" v-model="mergedCfg.userAgent" @update:modelValue="v => change('userAgent', v)"
                        label="User Agent" />
                    <VRow>
                        <VCol>
                            <h4>Remote Screen Options:</h4>
                            <v-switch density="compact" hide-details v-model="mergedCfg.screencastFullFps"
                                :color="mergedCfg.screencastFullFps ? 'success' : ''"
                                @update:modelValue="v => change('screencastFullFps', v)" label="Screencast Full FPS" />
                            <v-select v-model="mergedCfg.screencastFormat"
                                :color="mergedCfg.screencastFormat ? 'success' : ''"
                                @update:modelValue="v => change('screencastFormat', v)" label="Screencast Format"
                                :items="['jpeg', 'png']" />
                            <v-text-field type="number" min="0" max="100" step="10"
                                v-model="mergedCfg.screencastQuality"
                                :color="mergedCfg.screencastQuality ? 'success' : ''"
                                @update:modelValue="v => change('screencastQuality', v)"
                                label="Screencast JPEG Quality" />
                        </VCol>
                        <v-divider vertical />
                        <VCol>
                            <v-switch density="compact" hide-details v-model="mergedCfg.autoStart"
                                :color="mergedCfg.autoStart ? 'success' : ''"
                                @update:modelValue="v => change('autoStart', v)" label="Enable Autostart" />
                            <v-switch density="compact" hide-details v-model="mergedCfg.workflowEnabled"
                                :color="mergedCfg.workflowEnabled ? 'success' : ''"
                                @update:modelValue="v => change('workflowEnabled', v)" label="Enable Workflow" />
                            <v-switch density="compact" hide-details v-model="mergedCfg.headless"
                                :color="mergedCfg.headless ? 'success' : ''"
                                @update:modelValue="v => change('headless', v)" label="Headless / No Browser UI" />
                            <v-switch density="compact" hide-details v-model="mergedCfg.debugWAEvents"
                                :color="mergedCfg.debugWAEvents ? 'success' : ''"
                                @update:modelValue="v => change('debugWAEvents', v)" label="Debug WA Events" />
                            <v-switch density="compact" hide-details v-model="mergedCfg.devtools"
                                :color="mergedCfg.devtools ? 'success' : ''"
                                @update:modelValue="v => change('devtools', v)" label="Dev Tools" />
                            <v-switch density="compact" hide-details v-model="mergedCfg.disableVersionLock"
                                :color="mergedCfg.disableVersionLock ? 'success' : ''"
                                @update:modelValue="v => change('disableVersionLock', v)"
                                label="Disable Version Lock" />
                        </VCol>
                    </VRow>
                </v-form>
            </VCardText>
            <VCardActions>
                <VSpacer />
                <v-btn type="button" @click="submit" color="primary">Save</v-btn>
            </VCardActions>
        </VCard>
    </VDialog>
</template>

<script lang="ts" setup>
import { ref } from 'vue'
import type { SessionConfig } from '../../src/types';

const mergedCfg = ref<Partial<SessionConfig> | null>(null)
let currentCfg = ref<SessionConfig | null>(null)
const valid = ref(true)
const dialog = ref(false)
let changes: Partial<SessionConfig> = {}

function change(l: string, v: any) {
    changes[l] = v
    // console.log('ch', changes, arguments)
}

// const supportedBrowsers = ['chrome', 'firefox']
function show(config: SessionConfig) {
    changes = {}
    currentCfg.value = config
    fetch(`/session/${config.id}/merged-config`)
        .then(r => r.json())
        .then(json => {
            mergedCfg.value = json
            dialog.value = true
        })
}

defineExpose({ show })

async function submit() {
    if (!valid.value) {
        return
    }
    if (Object.keys(changes).length) {
        await fetch(`/session/${currentCfg.value?.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(changes)
        })
    }
    dialog.value = false
}
</script>
