<script setup lang="ts">
import WsIndicator from '../components/WsIndicator.vue';
import { waitSessions } from '../uses/sessions';
import SessionButtons from '../components/SessionControls.vue';
import ThemeSwitcher from '../components/ThemeSwitcher.vue';
import { useWsApiState } from '../uses/ws-api';
import SessionStates from '../components/SessionStates.vue';
import Breadcrumbs from '../components/Breadcrumbs.vue';
import ActiveWorkflowsIndicator from '../components/ActiveWorkflowsIndicator.vue';

const sessions = await waitSessions()
const wsState = useWsApiState()

function onCreate() {
    fetch('/create')
}

</script>

<template>
    <v-app-bar app density="compact">
        <Breadcrumbs :items="[{ title: 'Home', to: { name: 'home' } }]" />
        <v-spacer></v-spacer>
        <ActiveWorkflowsIndicator />
        <WsIndicator size="24" :state="wsState.state" />
        <ThemeSwitcher />
    </v-app-bar>
    <v-main>
        <v-container fluid class="fill-height">
            <v-row justify="center" no-gutters>
                <v-col xl="6" lg="8" md="10" sm="12">
                    <v-toolbar density="comfortable">
                        <VAppBarNavIcon size="small">
                            <VIcon size="xx-large">supervisor_account</VIcon>
                        </VAppBarNavIcon>
                        <v-toolbar-title>Whatsapp Web Sessions</v-toolbar-title>
                        <v-btn color="success" @click="onCreate" prepend-icon="add" variant="text">
                            Create Session
                        </v-btn>
                    </v-toolbar>

                    <v-card>
                        <v-list lines="two" v-if="sessions.size">
                            <v-list-item v-for="[id, item] in sessions" :key="id"
                                :to="{ name: 'session', params: { id } }">
                                <template v-slot:prepend>
                                    <v-avatar color="grey-lighten-1">
                                        <v-img v-if="item.account?.image" :src="item.account.image"></v-img>
                                        <v-icon v-else icon="person" />
                                    </v-avatar>
                                </template>
                                <VListItemTitle>
                                    {{ item.name }}
                                    <v-chip color="grey" v-if="item.waState.value.version" size="small">
                                        v{{ item.waState.value.version }}
                                    </v-chip>
                                    <template v-if="item.account">
                                        <v-chip size="small">
                                            {{ item.account.user }}
                                        </v-chip>
                                        <v-chip size="small">
                                            {{ item.account.name }}
                                        </v-chip>
                                    </template>
                                    <v-chip color="primary" v-if="item.waState.value.unread !== null" size="small">
                                        {{ item.waState.value.unread }} unread
                                    </v-chip>
                                </VListItemTitle>
                                <VListItemSubtitle>
                                    <SessionStates :session="item" />
                                </VListItemSubtitle>
                                <template v-slot:append>
                                    <SessionButtons :session="item" />
                                </template>
                            </v-list-item>
                        </v-list>
                        <v-card-text class="text-center" v-else>
                            There's no session, lets <v-btn variant="outlined" density="compact" color="primary" text
                                @click="onCreate">create
                                one</v-btn>
                        </v-card-text>
                    </v-card>
                </v-col>
            </v-row>
        </v-container>
    </v-main>
</template>
