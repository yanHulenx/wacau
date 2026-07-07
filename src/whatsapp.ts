import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  downloadContentFromMessage,
  type WASocket,
  type WAMessageContent,
} from '@whiskeysockets/baileys'
import path from 'path'
import fs from 'fs/promises'
import QRCode from 'qrcode'
import { config } from './config'
import { askGemini } from './gemini'
import { generateImage } from './image'
import { textToSpeech } from './tts'
import { speechToText } from './stt'
import { searchWeb } from './search'
import { scheduleRelative, scheduleCron, cancelTimer } from './cron'
import { ChatSession } from './types'
import { loadSession, saveSession, deleteSession } from './persist'

const sessions = new Map<string, ChatSession>()
let sock: WASocket
let latestQrDataUrl: string | null = null

const authDir = path.join(process.cwd(), 'wa_auth_session')

export function getQrDataUrl() { return latestQrDataUrl }

function jidToNum(jid: string): number {
  let hash = 0
  for (let i = 0; i < jid.length; i++) hash = ((hash << 5) - hash) + jid.charCodeAt(i)
  return hash
}

function parseRelativeTime(input: string): number {
  const match = input.match(/(\d+)\s*(menit|detik|jam|hari)/i)
  if (!match) return 0
  const num = parseInt(match[1])
  const unit = match[2].toLowerCase()
  const multipliers: Record<string, number> = { detik: 1, menit: 60, jam: 3600, hari: 86400 }
  return num * (multipliers[unit] || 0) * 1000
}

async function sendAudio(jid: string, filePath: string) {
  const buf = await fs.readFile(filePath)
  await sock.sendMessage(jid, { audio: buf, mimetype: 'audio/mp4' })
  await fs.unlink(filePath).catch(() => {})
}

async function sendVoiceNote(jid: string, filePath: string) {
  const buf = await fs.readFile(filePath)
  await sock.sendMessage(jid, { audio: buf, mimetype: 'audio/mp4', ptt: true })
  await fs.unlink(filePath).catch(() => {})
}

async function handleMessage(jid: string, text: string, useVoice = false) {
  const userId = jidToNum(jid)
  let session = sessions.get(jid)
  if (!session) {
    const saved = await loadSession(jid)
    session = saved || { userId, history: [], lastActive: Date.now() }
    sessions.set(jid, session)
  }

  session.history.push({ role: 'user', text })
  sock.sendPresenceUpdate('composing', jid).catch(() => {})
  const { text: reply, toolCalls } = await askGemini(text, session.history.slice(0, -1))
  session.history.push({ role: 'model', text: reply + toolCalls.map(t => `[TOOL:${t.name}]`).join('') })
  if (session.history.length > 20) session.history = session.history.slice(-20)
  await saveSession(jid, session)

  let replied = false
  for (const tool of toolCalls) {
    try {
      switch (tool.name) {
        case 'generate_image': {
          const file = await generateImage(tool.args.prompt)
          const buf = await fs.readFile(file)
          await sock.sendMessage(jid, { image: buf, caption: reply || undefined })
          await fs.unlink(file).catch(() => {})
          replied = true
          break
        }
        case 'text_to_speech': {
          const file = await textToSpeech(tool.args.text)
          await sendAudio(jid, file)
          replied = true
          break
        }
        case 'search': {
          const results = await searchWeb(tool.args.query)
          const SUMMARIZE_PROMPT = 'Ringkas hasil pencarian ini. GUNAKAN HANYA URL yang benar-benar ada di hasil. JANGAN membuat URL palsu. JANGAN kasih catatan/referensi tambahan. Jika user minta link: tampilkan maksimal 2 link dari hasil. Jika info umum: jangan tampilkan link.'
          const { text: summarized } = await askGemini(
            `Hasil pencarian untuk "${tool.args.query}":\n${results}`,
            [],
            SUMMARIZE_PROMPT
          )
          await sock.sendMessage(jid, { text: summarized })
          session.history.push({ role: 'model', text: summarized })
          replied = true
          break
        }
        case 'schedule': {
          const sendReminder = async (msg: string) => {
            try { await sock.sendMessage(jid, { text: `Reminder: ${msg}` }) } catch { }
          }
          const uid = userId
          if (tool.args.cron) scheduleCron(uid, tool.args.cron, tool.args.message, () => sendReminder(tool.args.message))
          else if (tool.args.at) {
            const [h, m] = tool.args.at.split(':')
            scheduleCron(uid, `${m} ${h} * * *`, tool.args.message, () => sendReminder(tool.args.message))
          } else if (tool.args.in) {
            const ms = parseRelativeTime(tool.args.in)
            if (ms > 0) scheduleRelative(uid, ms, tool.args.message, () => sendReminder(tool.args.message))
          }
          await sock.sendMessage(jid, { text: `Reminder diatur: ${tool.args.message}` })
          replied = true
          break
        }
      }
    } catch (err) {
      console.error(`WA tool ${tool.name} error:`, err)
      replied = true
    }
  }

  if (!replied && reply) {
    if (useVoice) {
      try { await sendVoiceNote(jid, await textToSpeech(reply)) }
      catch { await sock.sendMessage(jid, { text: reply }) }
    } else {
      await sock.sendMessage(jid, { text: reply })
    }
  }
}

function extractText(msg: WAMessageContent | undefined | null): string | null {
  if (!msg) return null
  const m = msg as any
  if (m.conversation) return m.conversation
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text
  if (m.imageMessage?.caption) return m.imageMessage.caption
  if (m.videoMessage?.caption) return m.videoMessage.caption
  return null
}

export async function startWaBot() {
  const { state, saveCreds } = await useMultiFileAuthState(authDir)

  sock = makeWASocket({
    auth: state,
    browser: Browsers.windows('Chrome'),
    printQRInTerminal: true,
    syncFullHistory: false,
    markOnlineOnConnect: false,
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      latestQrDataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 1 })
      try {
        const qrcode = require('qrcode-terminal')
        qrcode.generate(qr, { small: true })
        console.log('\nQR Code WhatsApp muncul di atas. Scan dengan WhatsApp > Linked Devices')
      } catch { }
      console.log(`Atau buka http://localhost:${config.port} untuk scan QR`)
    }
    if (connection === 'close') {
      const code = (lastDisconnect?.error as any)?.output?.statusCode || 500
      console.log(`WA disconnected (${code}), reconnecting in 5s...`)
      if (code !== DisconnectReason.loggedOut) {
        setTimeout(startWaBot, 5000)
      }
    }
    if (connection === 'open') {
      latestQrDataUrl = null
      console.log('WhatsApp bot connected!')
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (msg.key?.fromMe) continue
      if (!msg.message) continue
      if (msg.key?.remoteJid?.includes('@g.us')) continue

      const jid = msg.key.remoteJid!
      const text = extractText(msg.message)

      if (msg.message.imageMessage) {
        const caption = (msg.message as any).imageMessage?.caption || ''
        await handleMessage(jid, caption || 'gambar')
        continue
      }

      if (text) {
        const lower = text.toLowerCase()
        if (lower === 'hapus memory' || lower === 'reset memory') {
          sessions.delete(jid)
          await deleteSession(jid)
          await sock.sendMessage(jid, { text: 'Memori obrolan dibersihkan. Aku lupa semuanya! Mulai obrolan baru yuk.' })
          continue
        }
        if (lower === '/cancel') {
          cancelTimer(jidToNum(jid))
          await sock.sendMessage(jid, { text: 'Semua reminder dibatalkan.' })
          continue
        }
        if (text.toLowerCase() === '/start' || text.toLowerCase() === 'halo' || text.toLowerCase() === 'hi' || text.toLowerCase() === 'p') {
          await sock.sendMessage(jid, {
            text: 'Halo! Aku Asisten Hulenx.\n\n' +
              'Kemampuanku:\n' +
              '- Gambar: kirim "gambar kucing"\n' +
              '- Bacain teks: kirim "bacakan puisi"\n' +
              '- Ingatkan: kirim "ingatkan 5 menit lagi"\n' +
              '- Cari info: kirim "siapa presiden sekarang?"\n' +
              '- Cari link YouTube: kirim "cari link youtube..."\n' +
              '- Voice note: kirim voice, aku jawab\n' +
              '- /cancel batalkan reminder\n' +
              '- ketik "hapus memory" bersihkan obrolan'
          })
          continue
        }
        await handleMessage(jid, text)
        continue
      }

      if (msg.message.audioMessage) {
        const tmpDir = path.join(process.cwd(), 'output')
        await fs.mkdir(tmpDir, { recursive: true })
        const tmpPath = path.join(tmpDir, `wa_voice_${Date.now()}.ogg`)

        try {
          const stream = await downloadContentFromMessage(msg.message.audioMessage, 'audio')
          const chunks: Buffer[] = []
          for await (const chunk of stream) chunks.push(chunk)
          await fs.writeFile(tmpPath, Buffer.concat(chunks))
          const text = await speechToText(tmpPath)
          await handleMessage(jid, text, true)
        } catch (err) {
          console.error('WA voice error:', err)
          await sock.sendMessage(jid, { text: 'Gagal memproses voice note.' })
        } finally {
          await fs.unlink(tmpPath).catch(() => {})
        }
      }
    }
  })
}
