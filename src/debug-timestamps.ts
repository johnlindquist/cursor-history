import {extractGlobalConversations} from './db/extract-conversations.js'

async function main() {
  const conversations = await extractGlobalConversations()
  console.log(`Found ${conversations.length} total conversations\n`)

  // Sort conversations by the last message's clientEndTime
  const sortedConversations = conversations.sort((a, b) => {
    const aLastMessage = a.conversation.at(-1) as any
    const bLastMessage = b.conversation.at(-1) as any

    const aTime = aLastMessage?.timingInfo?.clientEndTime || aLastMessage?.timingInfo?.clientSettleTime || 0
    const bTime = bLastMessage?.timingInfo?.clientEndTime || bLastMessage?.timingInfo?.clientSettleTime || 0

    return bTime - aTime // Sort descending
  })

  console.log('=== Latest Conversations (by last message timing) ===\n')

  // Show top 3 conversations
  for (const conv of sortedConversations.slice(0, 3)) {
    const lastMessage = conv.conversation.at(-1) as any
    const timing = lastMessage?.timingInfo

    console.log('---')
    console.log(`Name: ${conv.name || 'Unnamed'}`)
    console.log(`Messages: ${conv.conversation.length}`)
    console.log(`Conversation Created At: ${new Date(conv.createdAt).toLocaleString()} (${conv.createdAt})`)
    if (timing) {
      console.log(`Last Message Timing:`)
      console.log(`- Client Start: ${new Date(timing.clientStartTime).toLocaleString()} (${timing.clientStartTime})`)
      console.log(`- Client End: ${new Date(timing.clientEndTime).toLocaleString()} (${timing.clientEndTime})`)
    }

    console.log('\nLast Message Debug Info:')
    console.log(`Available Keys: ${JSON.stringify(Object.keys(lastMessage), null, 2)}`)
    console.log(`Has content property: ${Object.hasOwn(lastMessage, 'content')}`)
    console.log(`Has text property: ${Object.hasOwn(lastMessage, 'text')}`)
    console.log(`Content type: ${typeof lastMessage.content}`)
    console.log(`Text type: ${typeof lastMessage.text}`)
    console.log('\nRaw Message Data:')
    console.log(JSON.stringify(lastMessage, null, 2))
    console.log('')
  }
}

await main().catch(console.error)
