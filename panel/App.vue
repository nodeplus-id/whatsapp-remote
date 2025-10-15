<script setup lang="ts">
import Popups from './components/Popups.vue'
import { useStorage } from './uses/storage';

// Load default config and other data into storage in early run
useStorage()

</script>

<template>
  <VApp>
    <RouterView v-slot="{ Component }">
      <Suspense>
        <!-- Default slot: Content to be rendered when async component is ready -->
        <template #default v-if="Component">
          <component :is="Component" />
        </template>
        <!-- Fallback slot: Content to be displayed while async component is loading -->
        <template #fallback>
          <v-main>
            <v-container fluid class="fill-height text-center">
              <v-card class="mx-auto loading-container" elevation="2">
                <v-card-text>
                  <v-progress-circular indeterminate color="blue-lighten-1" size="64" width="6"></v-progress-circular>
                  <p class="mt-4 text-subtitle-1 text-blue-darken-2">Loading content...</p>
                </v-card-text>
              </v-card>
            </v-container>
          </v-main>
        </template>
      </Suspense>
    </RouterView>
    <Popups />
  </VApp>
</template>
