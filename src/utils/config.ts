import Conf from 'conf'
import {existsSync, mkdirSync} from 'node:fs'
import path from 'node:path'

interface ConfigSchema {
  lastGeneration: null | string
}

const config = new Conf<ConfigSchema>({
  projectName: 'cursor-history',
  schema: {
    lastGeneration: {
      default: null,
      type: ['string', 'null'],
    },
  },
})

function getAppDataDir(): string {
  // Get the directory where conf stores its config file
  const configDir = path.dirname(config.path)
  return configDir
}

function getConversationsDir(): string {
  const appDir = getAppDataDir()
  const conversationsDir = path.join(appDir, 'conversations')

  if (!existsSync(conversationsDir)) {
    mkdirSync(conversationsDir)
  }

  return conversationsDir
}

export function getOutputDir(): string {
  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
  const baseDir = getConversationsDir()
  const outputDir = path.join(baseDir, timestamp)

  mkdirSync(outputDir)
  config.set('lastGeneration', timestamp)

  return outputDir
}

export function getLastGenerationPath(): null | string {
  const lastGeneration = config.get('lastGeneration')
  if (!lastGeneration) return null

  const baseDir = getConversationsDir()
  return path.join(baseDir, lastGeneration)
}

export function getConfigPath(): string {
  return config.path
}

export function getConversationsPath(): string {
  return getConversationsDir()
}
