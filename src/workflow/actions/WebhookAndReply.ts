import { registerAction } from "../action-register"
import { Break } from "../action-utils"


registerAction(
    {
        name: 'Webhook and Reply',
        type: 'remote',
        configs: {
            url: {
                label: "POST Webhook URL then use response as reply",
                type: "TEXT",
            }
        },
        consumes: {
            msg: {
                type: 'MESSAGE',
            }
        },
        produces: {
            response: {
                type: 'ANY'
            }
        }
    },
    async (configs, consumes, store, console, api) => {

        if (!configs.url) {
            throw new Error('Empty URL')
        }
        let url = configs.url

        const reqInit: RequestInit = {
            method: 'POST',
            keepalive: false
        }

        reqInit.body = JSON.stringify(consumes.msg)
        reqInit.headers = { "Content-Type": "application/json" }

        console.log(`${reqInit.method} ${url}`)
        const response = await fetch(url, reqInit)
            .then(r => {
                console.debug('Response', r.status, r.statusText)
                return r.text()
            })
            .then(
                async r => {
                    await api.sendCommand('sendText', [consumes.msg.from.id, r])
                    return r
                }
            )
        return { response }
    }
)
