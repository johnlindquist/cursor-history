import {existsSync, mkdirSync} from 'node:fs'
import path from 'node:path'

/**
 * Creates an output directory based on the current timestamp.
 * Returns the path of the new directory.
 */
export function createOutputDir(): string {
  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
  const baseDir = 'global-conversations'
  const outputDir = path.join(baseDir, timestamp)

  if (!existsSync(baseDir)) {
    mkdirSync(baseDir)
  }

  mkdirSync(outputDir)

  return outputDir
}
