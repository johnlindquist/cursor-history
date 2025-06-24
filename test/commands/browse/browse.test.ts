import { runCommand } from '@oclif/test'
import sinon from 'sinon'
import * as searchModule from '@inquirer/search'
import * as dbModule from '../../../dist/db/extract-conversations.js'
import clipboardy from 'clipboardy'
import { expect } from 'chai'

describe('chi --browse', () => {
    it('runs chi --browse and lets user pick', async () => {
        const workspace = { id: '1', name: 'my-ws', path: '/tmp/ws' }
        const conversation = {
            id: 'conv1',
            name: 'Test conv',
            createdAt: Date.now(),
            conversation: [],
            text: 'hello',
            workspaceName: 'my-ws'
        } as any

        const listWsStub = sinon.stub(dbModule, 'listWorkspaces').returns([workspace] as any)
        const getConvsStub = sinon.stub(dbModule, 'getConversationsForWorkspace').resolves([conversation] as any)

        const searchStub = sinon.stub(searchModule as any, 'default')
            .onFirstCall().resolves(workspace)
            .onSecondCall().resolves(conversation)

        const clipboardStub = sinon.stub(clipboardy, 'write').resolves()

        await runCommand('--browse')

        expect(searchStub.calledTwice).to.be.true

        // Cleanup
        listWsStub.restore()
        getConvsStub.restore()
        searchStub.restore()
        clipboardStub.restore()
    })
}) 