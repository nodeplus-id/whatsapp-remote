import path from "node:path"
import { homedir } from "node:os"
import { threadId } from "worker_threads"
import { getPackageJson, getBrowserPath } from "./utils/helper"

const isLiveDev = process.env.NODE_ENV == 'development' || ['dev', 'test'].includes(process.env.npm_lifecycle_event)
const showBrowser = !!process.env.SHOW_BROWSER

const browserArgs = [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    '--disable-gpu',
    showBrowser ? '--window-size=1200,800' : '--window-size=800,600',
    '--disable-session-crashed-bubble',
    '--no-first-run',
    '--no-startup-window'
]

if (process.env.DEBUG_BROWSER) {
    browserArgs.push('--remote-debugging-port=9222')
}
let dataDir: string
if (typeof process.env.DATA_DIR == 'string') {
    dataDir = path.resolve(process.env.DATA_DIR)
} else if (isLiveDev) {
    dataDir = path.join(process.cwd(), 'data');
} else { // default data dir location 
    dataDir = path.join(homedir(), ".local", "share", process.env.APP_NAME || 'whatsapp-remote');
}

const listenPort = parseInt(process.env.LISTEN_PORT || '8080') || 8080
const browserExe = process.env.IS_RUNNER ? '' : await getBrowserPath()
const packageJson = await getPackageJson()

export const config = {
    version: packageJson.version || '0.0.0',
    dataDir,
    workerLogsDir: path.resolve(dataDir, 'worker-logs'),
    listenPort,
    isLiveDev,
    showBrowser,
    browserExe,
    defaultBrowserArgs: browserArgs,
    defaultBrowserHeadless: !showBrowser,
    defaultUserAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    screencastFullFps: false,
    screencastQuality: 80,
    screencastFormat: 'jpeg',
    debugWAEvents: false,
    defaultWorkflowEnabled: true
}
console.info(`${process.pid}:${threadId} Config loading ${packageJson.name || '??'} v${config.version}`)
export default config