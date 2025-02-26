import path from 'path'

import * as vscode from 'vscode'

import { BotResponseMultiplexer } from '@sourcegraph/cody-shared/src/chat/bot-response-multiplexer'
import { ChatClient } from '@sourcegraph/cody-shared/src/chat/chat'
import { getPreamble } from '@sourcegraph/cody-shared/src/chat/preamble'
import { RecipeID } from '@sourcegraph/cody-shared/src/chat/recipes/recipe'
import { Transcript } from '@sourcegraph/cody-shared/src/chat/transcript'
import { ChatMessage, ChatHistory } from '@sourcegraph/cody-shared/src/chat/transcript/messages'
import { reformatBotMessage } from '@sourcegraph/cody-shared/src/chat/viewHelpers'
import { CodebaseContext } from '@sourcegraph/cody-shared/src/codebase-context'
import { ConfigurationWithAccessToken } from '@sourcegraph/cody-shared/src/configuration'
import { Guardrails, annotateAttribution } from '@sourcegraph/cody-shared/src/guardrails'
import { highlightTokens } from '@sourcegraph/cody-shared/src/hallucinations-detector'
import { IntentDetector } from '@sourcegraph/cody-shared/src/intent-detector'
import { Message } from '@sourcegraph/cody-shared/src/sourcegraph-api'

import { View } from '../../webviews/NavBar'
import { getFullConfig, updateConfiguration } from '../configuration'
import { VSCodeEditor } from '../editor/vscode-editor'
import { logEvent } from '../event-logger'
import { LocalAppDetector } from '../local-app-detector'
import { debug } from '../log'
import { FixupTask } from '../non-stop/FixupTask'
import { LocalStorage } from '../services/LocalStorageProvider'
import { CODY_ACCESS_TOKEN_SECRET, SecretStorage } from '../services/SecretStorageProvider'
import { TestSupport } from '../test-support'

import { fastFilesExist } from './fastFileFinder'
import {
    AuthStatus,
    ConfigurationSubsetForWebview,
    DOTCOM_URL,
    ExtensionMessage,
    WebviewMessage,
    defaultAuthStatus,
    isLoggedIn,
} from './protocol'
import { getRecipe } from './recipes'
import { getAuthStatus, getCodebaseContext } from './utils'

export type Config = Pick<
    ConfigurationWithAccessToken,
    | 'codebase'
    | 'serverEndpoint'
    | 'debugEnable'
    | 'debugFilter'
    | 'debugVerbose'
    | 'customHeaders'
    | 'accessToken'
    | 'useContext'
    | 'experimentalChatPredictions'
    | 'experimentalGuardrails'
>

export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    private isMessageInProgress = false
    private cancelCompletionCallback: (() => void) | null = null
    private webview?: Omit<vscode.Webview, 'postMessage'> & {
        postMessage(message: ExtensionMessage): Thenable<boolean>
    }

    private currentChatID = ''
    private inputHistory: string[] = []
    private chatHistory: ChatHistory = {}

    private transcript: Transcript = new Transcript()

    // Allows recipes to hook up subscribers to process sub-streams of bot output
    private multiplexer: BotResponseMultiplexer = new BotResponseMultiplexer()

    private configurationChangeEvent = new vscode.EventEmitter<void>()

    private disposables: vscode.Disposable[] = []

    // Codebase-context-related state
    private currentWorkspaceRoot: string

    private localAppDetector: LocalAppDetector

    constructor(
        private extensionPath: string,
        private config: Omit<Config, 'codebase'>, // should use codebaseContext.getCodebase() rather than config.codebase
        private chat: ChatClient,
        private intentDetector: IntentDetector,
        private codebaseContext: CodebaseContext,
        private guardrails: Guardrails,
        private editor: VSCodeEditor,
        private secretStorage: SecretStorage,
        private localStorage: LocalStorage,
        private rgPath: string
    ) {
        if (TestSupport.instance) {
            TestSupport.instance.chatViewProvider.set(this)
        }
        // chat id is used to identify chat session
        this.createNewChatID()

        this.disposables.push(this.configurationChangeEvent)

        // listen for vscode active editor change event
        this.currentWorkspaceRoot = ''
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(async () => {
                await this.updateCodebaseContext()
            }),
            vscode.workspace.onDidChangeConfiguration(async () => {
                this.config = await getFullConfig(this.secretStorage)
                const newCodebaseContext = await getCodebaseContext(this.config, this.rgPath, this.editor)
                if (newCodebaseContext) {
                    this.codebaseContext = newCodebaseContext
                    await this.setAnonymousUserID()
                }
            })
        )

        this.localAppDetector = new LocalAppDetector({
            onChange: isInstalled => {
                void this.webview?.postMessage({ type: 'app-state', isInstalled })

                // If app has been detected, we can stop the local app detector.
                if (isInstalled) {
                    this.localAppDetector.stop()
                }
            },
        })
        this.disposables.push(this.localAppDetector)
    }

    public onConfigurationChange(newConfig: Config): void {
        this.config = newConfig
        this.configurationChangeEvent.fire()
    }

    public async clearAndRestartSession(): Promise<void> {
        await this.saveTranscriptToChatHistory()
        await this.setAnonymousUserID()
        this.createNewChatID()
        this.cancelCompletion()
        this.isMessageInProgress = false
        this.transcript.reset()
        this.sendSuggestions([])
        this.sendTranscript()
        this.sendChatHistory()
    }

    public async clearHistory(): Promise<void> {
        this.chatHistory = {}
        this.inputHistory = []
        await this.localStorage.removeChatHistory()
    }

    public async setAnonymousUserID(): Promise<void> {
        await this.localStorage.setAnonymousUserID()
    }

    /**
     * Restores a session from a chatID
     */
    public async restoreSession(chatID: string): Promise<void> {
        await this.saveTranscriptToChatHistory()
        this.cancelCompletion()
        this.currentChatID = chatID
        this.transcript = Transcript.fromJSON(this.chatHistory[chatID])
        await this.transcript.toJSON()
        this.sendTranscript()
        this.sendChatHistory()
    }

    private async onDidReceiveMessage(message: WebviewMessage): Promise<void> {
        switch (message.command) {
            case 'initialized':
                debug('ChatViewProvider:onDidReceiveMessage:initialized', '')
                this.loadChatHistory()
                this.publishContextStatus()
                this.publishConfig()
                this.sendTranscript()
                this.sendChatHistory()
                await this.loadRecentChat()
                break
            case 'submit':
                await this.onHumanMessageSubmitted(message.text, message.submitType)
                break
            case 'edit':
                this.transcript.removeLastInteraction()
                await this.onHumanMessageSubmitted(message.text, 'user')
                break
            case 'executeRecipe':
                await this.executeRecipe(message.recipe)
                break
            case 'settings': {
                const authStatus = await getAuthStatus({
                    serverEndpoint: message.serverEndpoint,
                    accessToken: message.accessToken,
                    customHeaders: this.config.customHeaders,
                })

                await updateConfiguration('serverEndpoint', message.serverEndpoint)
                await this.secretStorage.store(CODY_ACCESS_TOKEN_SECRET, message.accessToken)
                await this.sendLogin(authStatus)
                break
            }
            case 'insert':
                await vscode.commands.executeCommand('cody.inline.insert', message.text)
                break
            case 'event':
                this.sendEvent(message.event, message.value)
                break
            case 'removeToken':
                await this.logout()
                break
            case 'removeHistory':
                await this.clearHistory()
                break
            case 'restoreHistory':
                await this.restoreSession(message.chatID)
                break
            case 'deleteHistory':
                await this.deleteHistory(message.chatID)
                break
            case 'links':
                void this.openExternalLinks(message.value)
                break
            case 'openFile': {
                const rootPath = this.editor.getWorkspaceRootPath()
                if (!rootPath) {
                    this.sendErrorToWebview('Failed to open file: missing rootPath')
                    return
                }
                try {
                    // This opens the file in the active column.
                    const uri = vscode.Uri.file(path.join(rootPath, message.filePath))
                    const doc = await vscode.workspace.openTextDocument(uri)
                    await vscode.window.showTextDocument(doc)
                } catch {
                    // Try to open the file in the sourcegraph view
                    const sourcegraphSearchURL = new URL(
                        `/search?q=context:global+file:${message.filePath}`,
                        this.config.serverEndpoint
                    ).href
                    void this.openExternalLinks(sourcegraphSearchURL)
                }
                break
            }
            default:
                this.sendErrorToWebview('Invalid request type from Webview')
        }
    }

    private createNewChatID(): void {
        this.currentChatID = new Date(Date.now()).toUTCString()
    }

    private sendPrompt(promptMessages: Message[], responsePrefix = ''): void {
        this.cancelCompletion()
        void vscode.commands.executeCommand('setContext', 'cody.reply.pending', true)

        let text = ''

        this.multiplexer.sub(BotResponseMultiplexer.DEFAULT_TOPIC, {
            onResponse: (content: string) => {
                text += content
                this.transcript.addAssistantResponse(reformatBotMessage(text, responsePrefix))
                this.sendTranscript()
                return Promise.resolve()
            },
            onTurnComplete: async () => {
                const lastInteraction = this.transcript.getLastInteraction()
                if (lastInteraction) {
                    const displayText = reformatBotMessage(text, responsePrefix)
                    const fileExistFunc = (filePaths: string[]): Promise<{ [filePath: string]: boolean }> => {
                        const rootPath = this.editor.getWorkspaceRootPath()
                        if (!rootPath) {
                            return Promise.resolve({})
                        }
                        return fastFilesExist(this.rgPath, rootPath, filePaths)
                    }
                    let { text: highlightedDisplayText } = await highlightTokens(
                        displayText || '',
                        fileExistFunc,
                        this.currentWorkspaceRoot
                    )
                    // TODO(keegancsmith) guardrails may be slow, we need to make this async update the interaction.
                    highlightedDisplayText = await this.guardrailsAnnotateAttributions(highlightedDisplayText)
                    this.transcript.addAssistantResponse(text || '', highlightedDisplayText)
                    this.editor.controllers.inline.reply(highlightedDisplayText)
                }
                void this.onCompletionEnd()
            },
        })

        let textConsumed = 0

        this.cancelCompletionCallback = this.chat.chat(promptMessages, {
            onChange: text => {
                // TODO(dpc): The multiplexer can handle incremental text. Change chat to provide incremental text.
                text = text.slice(textConsumed)
                textConsumed += text.length
                void this.multiplexer.publish(text)
            },
            onComplete: () => {
                void this.multiplexer.notifyTurnComplete()
            },
            onError: (err, statusCode) => {
                // Display error message as assistant response
                this.transcript.addErrorAsAssistantResponse(err)
                // Log users out on unauth error
                if (statusCode && statusCode >= 400 && statusCode <= 410) {
                    const authStatus = { ...defaultAuthStatus }
                    if (statusCode === 403) {
                        authStatus.authenticated = true
                        authStatus.requiresVerifiedEmail = true
                    } else {
                        authStatus.showInvalidAccessTokenError = true
                    }
                    debug('ChatViewProvider:onError:unauth', err, { verbose: { authStatus } })
                    void this.sendLogin(authStatus)
                    void this.clearAndRestartSession()
                }
                this.onCompletionEnd()
                void this.editor.controllers.inline.error()
                console.error(`Completion request failed: ${err}`)
            },
        })
    }

    private cancelCompletion(): void {
        this.cancelCompletionCallback?.()
        this.cancelCompletionCallback = null
    }

    private onCompletionEnd(): void {
        this.isMessageInProgress = false
        this.cancelCompletionCallback = null
        this.sendTranscript()
        void this.saveTranscriptToChatHistory()
        this.sendChatHistory()
        void vscode.commands.executeCommand('setContext', 'cody.reply.pending', false)
        this.logEmbeddingsSearchErrors()
    }

    private async onHumanMessageSubmitted(text: string, submitType: 'user' | 'suggestion'): Promise<void> {
        debug('ChatViewProvider:onHumanMessageSubmitted', '', { verbose: { text, submitType } })
        if (submitType === 'suggestion') {
            logEvent('CodyVSCodeExtension:chatPredictions:used')
        }
        this.inputHistory.push(text)
        if (this.config.experimentalChatPredictions) {
            void this.runRecipeForSuggestion('next-questions', text)
        }
        await this.executeChatCommands(text)
    }

    private async executeChatCommands(text: string): Promise<void> {
        switch (true) {
            case /^\/r(est)?\s/i.test(text):
                await this.clearAndRestartSession()
                break
            case /^\/s(earch)?\s/i.test(text):
                await this.executeRecipe('context-search', text)
                break
            default:
                return this.executeRecipe('chat-question', text)
        }
    }

    private async updateCodebaseContext(): Promise<void> {
        if (!this.editor.getActiveTextEditor() && vscode.window.visibleTextEditors.length !== 0) {
            // these are ephemeral
            return
        }
        const workspaceRoot = this.editor.getWorkspaceRootPath()
        if (!workspaceRoot || workspaceRoot === '' || workspaceRoot === this.currentWorkspaceRoot) {
            return
        }
        this.currentWorkspaceRoot = workspaceRoot

        const codebaseContext = await getCodebaseContext(this.config, this.rgPath, this.editor)
        if (!codebaseContext) {
            return
        }
        // after await, check we're still hitting the same workspace root
        if (this.currentWorkspaceRoot !== workspaceRoot) {
            return
        }

        this.codebaseContext = codebaseContext
        this.publishContextStatus()
    }

    public async executeRecipe(recipeId: RecipeID, humanChatInput: string = '', showTab = true): Promise<void> {
        debug('ChatViewProvider:executeRecipe', recipeId, { verbose: humanChatInput })
        if (this.isMessageInProgress) {
            this.sendErrorToWebview('Cannot execute multiple recipes. Please wait for the current recipe to finish.')
            return
        }

        const recipe = getRecipe(recipeId)
        if (!recipe) {
            return
        }

        // Create a new multiplexer to drop any old subscribers
        this.multiplexer = new BotResponseMultiplexer()

        const interaction = await recipe.getInteraction(humanChatInput, {
            editor: this.editor,
            intentDetector: this.intentDetector,
            codebaseContext: this.codebaseContext,
            responseMultiplexer: this.multiplexer,
            firstInteraction: this.transcript.isEmpty,
        })
        if (!interaction) {
            return
        }
        this.isMessageInProgress = true
        this.transcript.addInteraction(interaction)

        if (showTab) {
            this.showTab('chat')
        }

        // Check whether or not to connect to LLM backend for responses
        // Ex: performing fuzzy / context-search does not require responses from LLM backend
        switch (recipeId) {
            case 'context-search':
                this.onCompletionEnd()
                break
            default: {
                this.sendTranscript()

                const prompt = await this.transcript.toPrompt(getPreamble(this.codebaseContext.getCodebase()))
                this.sendPrompt(prompt, interaction.getAssistantMessage().prefix ?? '')
                await this.saveTranscriptToChatHistory()
            }
        }

        logEvent(`CodyVSCodeExtension:recipe:${recipe.id}:executed`)
    }

    private async runRecipeForSuggestion(recipeId: RecipeID, humanChatInput: string = ''): Promise<void> {
        const recipe = getRecipe(recipeId)
        if (!recipe) {
            return
        }

        const multiplexer = new BotResponseMultiplexer()
        const transcript = Transcript.fromJSON(await this.transcript.toJSON())

        const interaction = await recipe.getInteraction(humanChatInput, {
            editor: this.editor,
            intentDetector: this.intentDetector,
            codebaseContext: this.codebaseContext,
            responseMultiplexer: multiplexer,
            firstInteraction: this.transcript.isEmpty,
        })
        if (!interaction) {
            return
        }
        transcript.addInteraction(interaction)

        const prompt = await transcript.toPrompt(getPreamble(this.codebaseContext.getCodebase()))

        logEvent(`CodyVSCodeExtension:recipe:${recipe.id}:executed`)

        let text = ''
        multiplexer.sub(BotResponseMultiplexer.DEFAULT_TOPIC, {
            onResponse: (content: string) => {
                text += content
                return Promise.resolve()
            },
            onTurnComplete: () => {
                const suggestions = text
                    .split('\n')
                    .slice(0, 3)
                    .map(line => line.trim().replace(/^-/, '').trim())
                this.sendSuggestions(suggestions)
                return Promise.resolve()
            },
        })

        let textConsumed = 0
        this.chat.chat(prompt, {
            onChange: text => {
                // TODO(dpc): The multiplexer can handle incremental text. Change chat to provide incremental text.
                text = text.slice(textConsumed)
                textConsumed += text.length
                void multiplexer.publish(text)
            },
            onComplete: () => {
                void multiplexer.notifyTurnComplete()
            },
            onError: (error, statusCode) => {
                console.error(error, statusCode)
            },
        })
    }

    private async guardrailsAnnotateAttributions(text: string): Promise<string> {
        if (!this.config.experimentalGuardrails) {
            return text
        }

        const result = await annotateAttribution(this.guardrails, text)

        // Only log telemetry if we did work (ie had to annotate something).
        if (result.codeBlocks > 0) {
            const event = {
                codeBlocks: result.codeBlocks,
                duration: result.duration,
            }
            logEvent('CodyVSCodeExtension:guardrails:annotate', event, event)
        }

        return result.text
    }

    private showTab(tab: string): void {
        void vscode.commands.executeCommand('cody.chat.focus')
        void this.webview?.postMessage({ type: 'showTab', tab })
    }

    /**
     * Send transcript to webview
     */
    private sendTranscript(): void {
        void this.webview?.postMessage({
            type: 'transcript',
            messages: this.transcript.toChat(),
            isMessageInProgress: this.isMessageInProgress,
        })
    }

    private sendSuggestions(suggestions: string[]): void {
        void this.webview?.postMessage({
            type: 'suggestions',
            suggestions,
        })
    }

    private async saveTranscriptToChatHistory(): Promise<void> {
        if (this.transcript.isEmpty) {
            return
        }
        this.chatHistory[this.currentChatID] = await this.transcript.toJSON()
        await this.saveChatHistory()
    }

    /**
     * Save chat history
     */
    private async saveChatHistory(): Promise<void> {
        const userHistory = {
            chat: this.chatHistory,
            input: this.inputHistory,
        }
        await this.localStorage.setChatHistory(userHistory)
    }

    /**
     * Save Login state to webview
     */
    public async sendLogin(authStatus: AuthStatus): Promise<void> {
        // activate extension when user has valid login
        await vscode.commands.executeCommand('setContext', 'cody.activated', isLoggedIn(authStatus))
        await this.webview?.postMessage({ type: 'login', authStatus })
        this.sendEvent('auth', 'login')
    }

    /**
     * Logout deletes token from secret storage
     * Also removes the avtivate status for the extension to disable access to all commands and set webview back to login view
     */
    public async logout(): Promise<void> {
        await this.secretStorage.delete(CODY_ACCESS_TOKEN_SECRET)
        await vscode.commands.executeCommand('setContext', 'cody.activated', false)
        this.sendEvent('token', 'Delete')
        this.sendEvent('auth', 'logout')
        this.setWebviewView('login')
    }

    /**
     * Delete history from current chat history and local storage
     */
    private async deleteHistory(chatID: string): Promise<void> {
        delete this.chatHistory[chatID]
        await this.localStorage.deleteChatHistory(chatID)
        this.sendChatHistory()
    }

    /**
     * Loads chat history from local storage
     */
    private loadChatHistory(): void {
        const localHistory = this.localStorage.getChatHistory()
        if (localHistory) {
            this.chatHistory = localHistory?.chat
            this.inputHistory = localHistory.input
        }
    }

    /**
     * Loads the most recent chat
     */
    private async loadRecentChat(): Promise<void> {
        const localHistory = this.localStorage.getChatHistory()
        if (localHistory) {
            const chats = localHistory.chat
            const sortedChats = Object.entries(chats).sort(
                (a, b) => +new Date(b[1].lastInteractionTimestamp) - +new Date(a[1].lastInteractionTimestamp)
            )
            const chatID = sortedChats[0][0]
            await this.restoreSession(chatID)
        }
    }

    /**
     * Sends chat history to webview
     */
    private sendChatHistory(): void {
        void this.webview?.postMessage({
            type: 'history',
            messages: {
                chat: this.chatHistory,
                input: this.inputHistory,
            },
        })
    }

    /**
     * Publish the current context status to the webview.
     */
    private publishContextStatus(): void {
        const send = (): void => {
            const editorContext = this.editor.getActiveTextEditor()
            void this.webview?.postMessage({
                type: 'contextStatus',
                contextStatus: {
                    mode: this.config.useContext,
                    connection: this.codebaseContext.checkEmbeddingsConnection(),
                    codebase: this.codebaseContext.getCodebase(),
                    filePath: editorContext ? vscode.workspace.asRelativePath(editorContext.filePath) : undefined,
                    supportsKeyword: true,
                },
            })
        }
        this.disposables.push(vscode.window.onDidChangeTextEditorSelection(() => send()))
        send()
    }

    /**
     * Send embedding connections or results error to output
     */
    private logEmbeddingsSearchErrors(): void {
        if (this.config.useContext !== 'embeddings') {
            return
        }
        const searchErrors = this.codebaseContext.getEmbeddingSearchErrors()
        // Display error message as assistant response for users with indexed codebase but getting search errors
        if (this.codebaseContext.checkEmbeddingsConnection() && searchErrors) {
            this.transcript.addErrorAsAssistantResponse(searchErrors)
            debug('ChatViewProvider:onLogEmbeddingsErrors', '', { verbose: searchErrors })
        }
    }

    /**
     * Publish the config to the webview.
     */
    private publishConfig(): void {
        const send = async (): Promise<void> => {
            // update codebase context on configuration change
            void this.updateCodebaseContext()
            // check if new configuration change is valid or not
            // log user out if config is invalid
            const authStatus = await getAuthStatus({
                serverEndpoint: this.config.serverEndpoint,
                accessToken: this.config.accessToken,
                customHeaders: this.config.customHeaders,
            })

            // Ensure local app detector is running
            if (!isLoggedIn(authStatus)) {
                this.localAppDetector.start()
            } else {
                this.localAppDetector.stop()
            }

            const configForWebview: ConfigurationSubsetForWebview = {
                debugEnable: this.config.debugEnable,
                serverEndpoint: this.config.serverEndpoint,
            }
            void vscode.commands.executeCommand('setContext', 'cody.activated', isLoggedIn(authStatus))
            void this.webview?.postMessage({ type: 'config', config: configForWebview, authStatus })
        }

        this.disposables.push(this.configurationChangeEvent.event(() => send()))
        send().catch(error => console.error(error))
    }

    /**
     * Log Events
     */
    public sendEvent(event: string, value: string): void {
        const isPrivateInstance = new URL(this.config.serverEndpoint).href !== DOTCOM_URL.href
        const endpointUri = { serverEndpoint: this.config.serverEndpoint }
        const chatTranscript = { chatTranscript: this.transcript.toChat() }
        switch (event) {
            case 'feedback':
                // Only include context for dot com users with connected codebase
                logEvent(
                    `CodyVSCodeExtension:codyFeedback:${value}`,
                    null,
                    !isPrivateInstance && this.codebaseContext.getCodebase() ? chatTranscript : null
                )
                break
            case 'token':
                logEvent(`CodyVSCodeExtension:cody${value}AccessToken:clicked`, endpointUri, endpointUri)
                break
            case 'auth':
                logEvent(`CodyVSCodeExtension:${value}:clicked`, endpointUri, endpointUri)
                break
            // aditya combine this with above statemenet for auth or click
            case 'click':
                logEvent(`CodyVSCodeExtension:${value}:clicked`, endpointUri, endpointUri)
                break
        }
    }

    /**
     * Display error message in webview view as banner in chat view
     * It does not display error message as assistant response
     */
    public sendErrorToWebview(errorMsg: string): void {
        void this.webview?.postMessage({ type: 'errors', errors: errorMsg })
    }

    /**
     * Set webview view
     */
    public setWebviewView(view: View): void {
        void vscode.commands.executeCommand('cody.chat.focus')
        void this.webview?.postMessage({
            type: 'view',
            messages: view,
        })
    }

    /**
     * create webview resources
     */
    public async resolveWebviewView(
        webviewView: vscode.WebviewView,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _context: vscode.WebviewViewResolveContext<unknown>,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _token: vscode.CancellationToken
    ): Promise<void> {
        this.webview = webviewView.webview

        const extensionPath = vscode.Uri.file(this.extensionPath)
        const webviewPath = vscode.Uri.joinPath(extensionPath, 'dist')

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [webviewPath],
        }

        // Create Webview using client/cody/index.html
        const root = vscode.Uri.joinPath(webviewPath, 'index.html')
        const bytes = await vscode.workspace.fs.readFile(root)
        const decoded = new TextDecoder('utf-8').decode(bytes)
        const resources = webviewView.webview.asWebviewUri(webviewPath)

        // Set HTML for webview
        // This replace variables from the client/cody/dist/index.html with webview info
        // 1. Update URIs to load styles and scripts into webview (eg. path that starts with ./)
        // 2. Update URIs for content security policy to only allow specific scripts to be run
        webviewView.webview.html = decoded
            .replaceAll('./', `${resources.toString()}/`)
            .replaceAll('{cspSource}', webviewView.webview.cspSource)

        // Register webview
        this.disposables.push(webviewView.webview.onDidReceiveMessage(message => this.onDidReceiveMessage(message)))
    }

    /**
     * Open external links
     */
    private async openExternalLinks(uri: string): Promise<void> {
        try {
            await vscode.env.openExternal(vscode.Uri.parse(uri))
        } catch (error) {
            throw new Error(`Failed to open file: ${error}`)
        }
    }

    public transcriptForTesting(testing: TestSupport): ChatMessage[] {
        if (!testing) {
            console.error('used ForTesting method without test support object')
            return []
        }
        return this.transcript.toChat()
    }

    public fixupTasksForTesting(testing: TestSupport): FixupTask[] {
        if (!testing) {
            console.error('used ForTesting method without test support object')
            return []
        }
        return this.editor.controllers.task.getTasks()
    }

    public dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose()
        }
        this.disposables = []
    }
}
