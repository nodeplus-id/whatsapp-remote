import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import vuetify from './plugins/vuetify'
import App from './App.vue'
import Main from './views/Main.vue'
import Session from './views/Session.vue'

const router = createRouter({
    history: createWebHistory(),
    routes: [
        {
            path: '/',
            name: 'home',
            component: Main,
        },
        {
            path: '/session/:id',
            name: 'session',
            props: true,
            component: Session,
        },
        {
            path: '/session/:id/workflow',
            name: 'workflow',
            props: true,
            component: () => import('./views/Workflow.vue'),
        }
    ]
})

createApp(App).use(vuetify).use(router).mount('#app')
