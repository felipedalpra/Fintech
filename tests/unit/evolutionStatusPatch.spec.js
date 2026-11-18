import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyPatch } from '../../infra/evolution-api/patch-status.cjs'

const fixture = `
const sendMessageAck = async node => node
const onUnexpectedError = () => {}
    const makeOfflineNodeProcessor = () => {
        const nodeProcessorMap = new Map([
            ['message', handleMessage],
            ['call', handleCall],
            ['receipt', handleReceipt],
            ['notification', handleNotification]
        ])
    }
    ws.on('CB:notification', async (node) => {
        await processNode('notification', node, 'handling notification', handleNotification);
    });
`

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evolution-status-patch-'))
  const baileys = path.join(root, 'baileys')
  fs.mkdirSync(path.join(baileys, 'lib', 'Socket'), { recursive: true })
  fs.writeFileSync(path.join(baileys, 'package.json'), JSON.stringify({ version: '7.0.0-rc.9' }))
  fs.writeFileSync(path.join(baileys, 'lib', 'Socket', 'messages-recv.js'), fixture)
  return { root, baileys }
}

test('aplica o ack de status e não aplica o patch duas vezes', () => {
  const { root, baileys } = createFixture()
  try {
    expect(applyPatch(baileys).changed).toBe(true)
    const target = fs.readFileSync(path.join(baileys, 'lib', 'Socket', 'messages-recv.js'), 'utf8')
    expect(target).toContain("['status', handleStatus]")
    expect(target).toContain("ws.on('CB:status'")
    expect(target.match(/CB:status/g)).toHaveLength(1)
    expect(applyPatch(baileys).changed).toBe(false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('recusa aplicar o patch em versão desconhecida', () => {
  const { root, baileys } = createFixture()
  try {
    fs.writeFileSync(path.join(baileys, 'package.json'), JSON.stringify({ version: '7.0.0-rc.13' }))
    expect(() => applyPatch(baileys)).toThrow(/Unsupported Baileys version/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
