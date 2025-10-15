import pc, { type Page, type Browser, ConsoleMessage, CDPSession, Protocol } from "puppeteer-core"
import { SessionConfig, mouseButtonMap, SessionState, WaStates, WaStates_V, WaStatesNull, WsData } from "../types"
import { injectRemote, injectVersionLock } from "../utils/browser"
import { SOCKET_STATE, SOCKET_STREAM } from "../waweb/WAWebSocketConstants"
import { WsClient } from "../server/websocket"
import { RawData } from "ws"
import defaultConfig from "../config"
import { WS } from "../server/listeners"
import { MANAGER } from "./manager"
import { slugify, vueflowToWorkflowConfig } from "../utils/shared"

const sessionDefaultConfig: Omit<SessionConfig, 'id' | 'name' | 'dataDir'> = {
    executablePath: defaultConfig.browserExe ?? undefined,
    userAgent: defaultConfig.defaultUserAgent,
    headless: defaultConfig.defaultBrowserHeadless,
    args: defaultConfig.defaultBrowserArgs,
    screencastFullFps: defaultConfig.screencastFullFps,
    screencastQuality: defaultConfig.screencastQuality,
    screencastFormat: defaultConfig.screencastFormat,
    debugWAEvents: defaultConfig.debugWAEvents,
    devtools: false,
    disableVersionLock: false,
    autoStart: false,
    workflowEnabled: defaultConfig.defaultWorkflowEnabled,
}

/**
 * WhatsApp Session
 */
export default class Session {
    private _state = SessionState.stopped
    browser: Browser
    page: Page

    waStates: WaStates = Object.assign({}, WaStatesNull())
    private screenShares = new Set<WsClient>()
    private cdp: CDPSession
    private lastBuffer: Buffer
    private lastFrame: string
    private lastFrameTimestamp = 0
    private lastTimestamp = 0
    private minInterval = 1 / 15 // 5 FPS = 200ms per frame
    private lastFrameFlusher: NodeJS.Timeout

    constructor(public config: SessionConfig) { }

    private async initCDP() {
        const fullFps = (this.config.screencastFullFps ?? defaultConfig.screencastFullFps)
        this.cdp = await this.page.createCDPSession();
        this.cdp.on('Page.screencastFrame', fullFps ? this.onScreenCastFrameFullFps : this.onScreenCastFrame)
        const ret = await this.cdp.send('Page.startScreencast', {
            format: this.config.screencastFormat ?? defaultConfig.screencastFormat as any,
            quality: this.config.screencastQuality ?? defaultConfig.screencastQuality,             // 0–100, only for jpeg
            maxWidth: this.waStates.viewport?.width || 800,
            maxHeight: this.waStates.viewport?.height || 600,
            everyNthFrame: 1         // lower FPS by skipping frames
        }).catch(e => {
            console.warn(e)
            return false
        });

        if (ret === false) return ret
        if (!fullFps) {
            this.lastFrameFlusher = setInterval(
                () => {
                    if (!this.lastFrame) return

                    // console.debug(this.lastFrameTimestamp, 'FLUSH*')
                    this.lastTimestamp = this.lastFrameTimestamp
                    this.lastBuffer = Buffer.from(this.lastFrame, 'base64')
                    this.screenShares.forEach((ws) => ws.send(this.lastBuffer))
                    this.lastFrame = null
                }, this.minInterval * 1000)
        }
        console.debug('CDP START')
        return true
    }

    private async stopCDP() {
        if (!this.cdp) return
        this.lastFrameFlusher && clearInterval(this.lastFrameFlusher)
        await this.cdp.send('Page.stopScreencast').catch(e => {/* ignored */ })
        await this.cdp.detach().catch(e => {/* ignored */ })
        this.cdp = undefined
        console.debug('CDP STOP')
    }

    private onScreenCastFrameFullFps = async ({ data, metadata, sessionId }: Protocol.Page.ScreencastFrameEvent) => {
        this.lastTimestamp = metadata.timestamp
        this.lastBuffer = Buffer.from(data, 'base64')
        this.screenShares.forEach((ws) => ws.send(this.lastBuffer))
        // Required: acknowledge receipt or stream pauses
        await this.cdp.send('Page.screencastFrameAck', { sessionId });
    }

    private onScreenCastFrame = async ({ data, metadata, sessionId }: Protocol.Page.ScreencastFrameEvent) => {
        // `data` is base64 image (jpeg/png)
        // console.log('CDP frame', metadata.timestamp, this.screenShares.size);
        if ((metadata.timestamp - this.lastTimestamp) >= this.minInterval) {
            // console.debug(metadata.timestamp, 'FLUSH')
            this.lastTimestamp = metadata.timestamp
            this.lastBuffer = Buffer.from(data, 'base64')
            this.screenShares.forEach((ws) => ws.send(this.lastBuffer))
            this.lastFrame = null
        } else {
            this.lastFrame = data
            this.lastFrameTimestamp = metadata.timestamp
            // console.debug(metadata.timestamp, 'SKIP')
        }
        // Required: acknowledge receipt or stream pauses
        await this.cdp.send('Page.screencastFrameAck', { sessionId });
    }

    async screenShareStart(ws: WsClient) {
        // not ready
        if (!this.page) return false

        if (!this.screenShares.has(ws)) {
            this.screenShares.add(ws)
            ws.once('close', () => this.screenShareStop(ws))
        }

        if (!this.cdp)
            try {
                this.initCDP()
            } catch (error) {
                console.error(error)
                return
            }

        if (this.lastBuffer) {
            ws.send(this.lastBuffer)
        }
        ws.on('message', this.handleWsMessage)
    }

    handleWsMessage = async (message: RawData, isBinary: boolean) => {
        if (isBinary) {
            return
        }
        const str = message.toString()

        if (str[0] != '@' || str.length < 3) {
            return
        }
        const params: any[] = str.slice(2).split(',')//.map(parseInt)
        // console.debug(str[1], params)
        try {
            switch (str[1]) {
                case 'D': // Mouse Down
                    await this.page.mouse.move(params[0], params[1])
                    await this.page.mouse.down({ button: mouseButtonMap[params[2]] })
                    break
                case 'U': // Mouse Up
                    await this.page.mouse.move(params[0], params[1])
                    await this.page.mouse.up({ button: mouseButtonMap[params[2]] })
                    break
                case 'S': // Scroll
                    await this.page.mouse.wheel({ deltaX: parseInt(params[0]), deltaY: parseInt(params[1]) })
                    break
            }
        } catch (error) {
            console.warn(error)
        }
    }

    screenShareStop(ws: WsClient) {
        try {
            ws.off('message', this.handleWsMessage)
            ws.sendData({ screen_share_stop: this.config.id })
        } catch (ignored) { }
        this.screenShares.delete(ws)
        if (this.screenShares.size == 0)
            this.stopCDP()
    }

    screenShareStopAll() {
        this.screenShares.forEach((ws) => this.screenShareStop(ws))
    }

    /** Merged config with default value */
    getMergedConfig(): SessionConfig {
        return {
            ...sessionDefaultConfig,
            ...this.config
        }
    }

    async start() {

        if (!this.config.executablePath && !defaultConfig.browserExe) {
            return Promise.reject(new Error('No Browser executable path is set, please set it manually in config.'))
        }

        this.state = SessionState.starting

        let workerUrl: string | undefined = undefined

        const mergedConfig = this.getMergedConfig()

        if (mergedConfig.workflowEnabled) {
            const workerName = slugify(mergedConfig.name)
            const wfData = MANAGER.getWorkflowData(mergedConfig.id)
            // Always start the worker even no Workflow data defined
            const workerConfig = vueflowToWorkflowConfig(wfData?.flow)
            const ret = await MANAGER.getOrCreateWorker(mergedConfig.id, workerName, workerConfig)
            workerUrl = ret.url
        } else {
            console.debug(`workflow not enabled for ${mergedConfig.name}`)
        }

        const browser = await pc.launch({
            headless: mergedConfig.headless,
            executablePath: mergedConfig.executablePath,
            browser: mergedConfig.browser,
            userDataDir: mergedConfig.dataDir,
            args: mergedConfig.args,
            devtools: mergedConfig.devtools,
            defaultViewport: null,
            waitForInitialPage: false,
            timeout: 2 * 60e3
        })
        const page = await browser.newPage()
        // const [page] = await browser.pages()

        // Whatsapp will not loaded in Headless User Agent
        await page.setUserAgent(mergedConfig.userAgent ?? defaultConfig.defaultUserAgent)

        this.browser = browser
        this.page = page
        this.page.on('close', this.onClose)

        // Expose function that can be called inside wa web browser
        await page.exposeFunction('_wa_state_', this.setWaState)
        // await page.exposeFunction('_msg_', this.newWaMsg)
        if (!mergedConfig.devtools) {
            await page.on('console', (msg: ConsoleMessage) => {
                console[msg.type()](`${mergedConfig.name}: ${msg.text()}`)
            })
        }

        // Inject our config into browser
        await page.evaluateOnNewDocument(REMOTE => {
            window['REMOTE'] = REMOTE
        }, { config: this.config, workerUrl });

        if (!mergedConfig.disableVersionLock) {
            await injectVersionLock(this.page)
        }

        // Inject our JS into web wa
        await injectRemote(this.page)

        // Disable open new tab
        // Listen for new targets (which include new pages/tabs)
        browser.on('targetcreated', async (target) => {
            if (target.type() === 'page') {
                const newPage = await target.page();
                await newPage.close();
                console.info(`Closed new page: ${newPage.url()}`);
            }
        });

        await page.goto('https://web.whatsapp.com')

        return this._state
    }
    get state() {
        return this._state
    }

    set state(state: SessionState) {

        if (state == this._state) return

        console.debug(`Session ${this.config.name}: ${SessionState[this._state]} -> ${SessionState[state]}`)
        this._state = state
        const data: WsData = { session_states: [[this.config.id, state]] }

        if (state == SessionState.stopped) {
            // reset but keep some information
            this.waStates = Object.assign({}, WaStatesNull(), {
                user: this.waStates.user,
                name: this.waStates.name,
            })
            // broadcast the states
            data.wa_states = [[this.config.id, this.waStates]]
        }

        WS.broadcast(data)
    }

    private setWaState = <T extends keyof WaStates_V>(stateKey: T, value: WaStates_V[T]) => {
        // console.debug(`WA STATE: ${stateName}:`, value);
        if (stateKey in this.waStates) {
            (this.waStates as any)[stateKey] = value
        } else if (stateKey == 'ready') {
            Object.assign(this.waStates, value)
            // update our DB
            MANAGER.patchConfig(this.config.id, {
                lastWaWebVersion: this.waStates.version,
                // autoStart: true,
                account: {
                    user: this.waStates.user,
                    device: this.waStates.device,
                    name: this.waStates.name,
                    image: this.waStates.image,
                    platform: this.waStates.platform,
                }
            })
            // set ready
            this.state = SessionState.ready
        } else {
            console.warn(`WA STATE: Unhandled ${stateKey} = ${value}`)
            return
        }

        WS.broadcast({ wa_states: [[this.config.id, this.waStates]] })

        // Internal logic that depends with WA States
        switch (stateKey) {
            case 'event':
                switch (value as (WaStates['event'])) {
                    case 'cmd_load':
                        // Ready, but we don't know is logged in or not
                        break
                    case 'me_ready':
                        this.state = SessionState.syncing
                        break
                }

                break
            case 'state':
                switch (value as SOCKET_STATE) {
                    case SOCKET_STATE.UNPAIRED /* SOCKET_STATE.PAIRING */:
                        this.state = SessionState.need_auth
                        break
                    case SOCKET_STATE.TOS_BLOCK:
                        this.state = SessionState.error
                        break
                }
                break
            case 'stream':
                switch (value as SOCKET_STREAM) {
                    case SOCKET_STREAM.CONNECTED:
                        this.state = SessionState.syncing
                        break
                    case SOCKET_STREAM.DISCONNECTED:
                        this.state = SessionState.error
                        break
                }
                break
            case 'remote_error':
                this.state = SessionState.error
                break
        }
    }

    private onClose = () => {
        console.debug(`Session ${this.config.name}: Browser page closed.`)
        this.state = SessionState.stopped
        this.page = null
        // Exit the browser (MacOS)
        if (this.browser.connected)
            this.browser.close().catch(() => { })
        this.browser = null
    }

    async stop() {

        if (this._state == SessionState.stopped || this._state == SessionState.stopping)
            return

        this.state = SessionState.stopping
        this.screenShareStopAll()
        if (this.page)
            await this.page.close({ runBeforeUnload: true })
        if (this.browser)
            await this.browser.close()
    }

    async pairing(phone: string, showNotification = true) {
        const code = await this.page.evaluate(async (phoneNumber, showNotification) => {
            const AltDeviceLinkingApi = require('WAWebAltDeviceLinkingApi')
            AltDeviceLinkingApi.setPairingType('ALT_DEVICE_LINKING')
            await AltDeviceLinkingApi.initializeAltDeviceLinking()
            return AltDeviceLinkingApi.startAltLinkingFlow(phoneNumber, showNotification)
        }, phone, showNotification)

        this.setWaState('paircode', code)
    }
}
