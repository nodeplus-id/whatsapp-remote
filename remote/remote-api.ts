import type { IWAWebChatModel } from "@src/waweb/WAWebChatModel"
import { Cmd, Collections, Wid } from "./exports"

const delay = (ms = 500) => new Promise(r => setTimeout(r, ms))

export class RemoteApi {
    /**
     * @param chatId 62857265xxxx@c.us or or g.us
     */
    private getChatById(chatId: string): IWAWebChatModel | undefined {
        return Collections.Chat.findFirst(f => f.id.toString() == chatId)
    }

    async chatFocus(chatId: string, noRead = false) {

        // console.debug('getChatById', chatId)
        let chat = this.getChatById(chatId)
        if (!chat) {
            return
        }

        // console.debug('openChatFromUnread', chatId)
        const ok = await Cmd.openChatBottom(chat, undefined)

        if (!ok) {
            return
        }
        // console.debug('focus', chatId)
        require("WAWebComposeBoxActions").ComposeBoxActions.focus(chat)
        // console.debug('scrollToActiveChat', chatId)
        Cmd.scrollToActiveChat()
        if (!noRead) {
            Cmd.markChatUnread(chat, false)
        }
        return chat
    }

    async sendText(chatId: string, msg: string) {
        const chat = await this.chatFocus(chatId)
        if (!chat) {
            // console.debug(`Focus chat failed`, chatId)
            return
        }
        // console.debug(`sendText`, chatId)
        await delay(200)
        require("WAWebComposeBoxActions").ComposeBoxActions.paste(chat, msg)
        await delay(200)
        require("WAWebComposeBoxActions").ComposeBoxActions.send(chat)
    }

    async markRead(chatId: string | IWAWebChatModel, markUnread = false) {
        let chat: IWAWebChatModel | undefined = typeof chatId == 'string' ? this.getChatById(chatId) : chatId
        if (!chat) return
        Cmd.markChatUnread(chat, markUnread)
        //d("WAWebCmd").Cmd.markChatUnread(chat, false)
    }
}

/* 
d("WAWebFrontendMsgGetters").getChat(this.msg);
*/

export const remoteApi = new RemoteApi()
// for debugging in console
window['api'] = remoteApi
