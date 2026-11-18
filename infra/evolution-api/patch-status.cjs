'use strict'

const fs = require('node:fs')
const path = require('node:path')

const EXPECTED_BAILEYS_VERSION = '7.0.0-rc.9'
const TARGET_FILE = path.join('lib', 'Socket', 'messages-recv.js')

function readPackageVersion(baileysDir) {
  const packagePath = path.join(baileysDir, 'package.json')
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
  return packageJson.version
}

function patchMessagesReceiver(source) {
  if (source.includes("ws.on('CB:status'")) {
    return { source, changed: false }
  }

  const processorMatch = source.match(/\n([ \\t]*)const makeOfflineNodeProcessor = \(\) => \{/)
  const mapMatch = source.match(/\n([ \\t]*)\['notification', handleNotification\](?=\n[ \\t]*\])/)
  const notificationMatch = source.match(/\n([ \\t]*)ws\.on\('CB:notification', async \(node\) => \{\n([ \\t]*)await processNode\('notification', node, 'handling notification', handleNotification\);\n\1\}\);/)

  if (!processorMatch || !mapMatch || !notificationMatch) {
    throw new Error('Baileys messages-recv.js: offline processor anchors not found')
  }

  const processorIndent = processorMatch[1]
  const mapEntryIndent = mapMatch[1]
  const eventIndent = notificationMatch[1]
  const bodyIndent = notificationMatch[2]
  const statusHandler = `\n${processorIndent}const handleStatus = async node => {\n${bodyIndent}try {\n${bodyIndent}  await sendMessageAck(node)\n${bodyIndent}} catch (error) {\n${bodyIndent}  onUnexpectedError(error, 'acking status stanza')\n${bodyIndent}}\n${processorIndent}}\n`
  const statusEvent = `\n${eventIndent}ws.on('CB:status', async node => {\n${bodyIndent}await processNode('status', node, 'acking status stanza', handleStatus)\n${eventIndent}});`
  const withHandler = source.replace(processorMatch[0], `${statusHandler}${processorMatch[0]}`)
  const withMap = withHandler.replace(mapMatch[0], `${mapMatch[0]},\n${mapEntryIndent}['status', handleStatus]`)
  const withStatusEvent = withMap.replace(notificationMatch[0], `${notificationMatch[0]}${statusEvent}`)
  return { source: withStatusEvent, changed: true }
}

function applyPatch(baileysDir) {
  const version = readPackageVersion(baileysDir)
  if (version !== EXPECTED_BAILEYS_VERSION) {
    throw new Error(`Unsupported Baileys version ${version}; expected ${EXPECTED_BAILEYS_VERSION}`)
  }

  const targetPath = path.join(baileysDir, TARGET_FILE)
  const original = fs.readFileSync(targetPath, 'utf8')
  const result = patchMessagesReceiver(original)

  if (result.changed) {
    fs.writeFileSync(targetPath, result.source)
  }

  return { version, targetPath, changed: result.changed }
}

if (require.main === module) {
  const baileysDir = process.argv[2]
  if (!baileysDir) {
    throw new Error('Usage: node patch-status.cjs <baileys-directory>')
  }

  const result = applyPatch(baileysDir)
  console.log(`${result.changed ? 'Applied' : 'Already applied'} status stanza ack patch to Baileys ${result.version}`)
}

module.exports = { applyPatch, patchMessagesReceiver }
