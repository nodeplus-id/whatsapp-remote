/**
 * This script will be injected into the Whatsapp Web page :-)
 */
import type { MsgPayload } from "@src/types/apps-types";
import { RemoteError, type SessionConfig, type WaStates, type WaStatesFunc } from "../src/types";
import { SOCKET_STATE, type SOCKET_STREAM } from "../src/waweb/WAWebSocketConstants";
import type { Auth } from "./auth";
import type { Runtime } from "./runtime";
import { RemoteWs } from "./remote-ws";

type T_WA = WaStates & { ready?: Partial<WaStates> }
declare global {
    var Debug: any
    var REMOTE: { auth?: Auth, runtime?: Runtime, config: SessionConfig, workerUrl?: string }
    var _wa_state_: WaStatesFunc
    var _wa_state_delayed: WaStatesFunc
    var _msg_: (msg: MsgPayload) => void
    var workerWs: WebSocket | undefined
}

let _wa_state_timer: { [key in keyof T_WA]?: any } = {}
window._wa_state_delayed = function (stateName, value) {
    clearTimeout(_wa_state_timer[stateName])
    _wa_state_timer[stateName] = setTimeout(() => _wa_state_(stateName, value), 500)
};
// Disable crash logs
try {
    const cl = require('WAWebCrashlog')
    cl.reset()
    cl.upload = cl.constructor.upload = async function () {
        // console.debug('WAWebCrashlog.upload called.', arguments)
    }
    cl.sendLogs = cl.constructor.sendLogs = async function () {
        // console.debug('WAWebCrashlog.sendLogs called.', arguments)
    }
} catch (e) { console.warn(`Fail disabled crash log: ${e?.['message'] || e}`) }

(async () => {
    // wait whatsapp loaded
    let counter = 0
    while (typeof window.Debug == 'undefined' || typeof window.require == 'undefined') {
        console.log("Waiting ready..")
        await new Promise(r => setTimeout(r, 500))
        // 40s timeout
        if (++counter >= 80) {
            console.error("Timeout waiting..")
            _wa_state_('remote_error', RemoteError.TIMEOUT_NO_WAWEB)
            counter = -2
            break
        }
    }
    if (counter < 0) return

    // Global function that will be called if got new message
    window._msg_ = (msg) => { }

    _wa_state_('viewport', {
        width: window.innerWidth,
        height: window.innerHeight,
        pixelRatio: window.devicePixelRatio
    })
    _wa_state_('version', Debug.VERSION)

    console.log("Exposing modules..")

    const [{ Socket, Cmd, Conn }, ws] = await Promise.all([
        import('./exports').then(exports => {
            return window['exports'] = exports
        }),
        new Promise((r, j) => {
            if (!REMOTE.workerUrl){
                console.debug(`No worker Url defined.`)
                return r(null)
            }

            console.debug(`Connecting to worker ${REMOTE.workerUrl}`)
            const ws = new RemoteWs(REMOTE.workerUrl)
            ws.connect((e) => {
                if (e) {
                    console.error(`WorkerWS Failed, exiting..`, e)
                    j(e)
                    window.close()
                    return
                }
                // Send msg to worker
                window._msg_ = (msg) => ws.push(msg)
                window.addEventListener('unload', (event) => {
                    ws.close()
                })
                r(ws)
            })
        })
    ])

    Cmd.once('initial_load_ready', () => _wa_state_('event', 'cmd_load'))
    Cmd.once('main_loaded', () => _wa_state_('event', 'cmd_load'))
    Conn.once('me_ready', () => _wa_state_('event', 'me_ready'))

    if (REMOTE.config.debugWAEvents) {
        await import('./debugger')
    }


    let auth: Auth | null = null
    let runtime: Runtime | null = null

    console.log("Listening states..");
    Socket.on('change:state', (_src: any/* Socket */, value: SOCKET_STATE, _old: SOCKET_STATE) => {
        _wa_state_('state', value)

        if (value == 'UNPAIRED' && !auth) {
            import("./auth").then(({ Auth }) => {
                auth = window.REMOTE.auth = new Auth((qrcode) => {
                    _wa_state_('qrcode', qrcode)
                })
            })
        }
        // Early WA socket connection
        // else if (value == 'CONNECTED' && !runtime) { }
    })

    // Or you can use Socket.on('change:hasSynced')
    Socket.on('change:stream', (_src: any/* Socket */, value: SOCKET_STREAM, _old: SOCKET_STREAM) => {
        _wa_state_('stream', value)
        if (value == "CONNECTED" && !runtime) {
            // start the main runtime
            import("./runtime").then(({ Runtime }) => {
                runtime = window.REMOTE.runtime = new Runtime()
                runtime.start()
            })
        }
    })

})()
