import { Telegraf, Context } from 'telegraf'
import { config } from './config'
import { askGemini } from './gemini'
import { ChatSession } from './types'
import { textToSpeech } from './tts'
import { generateImage } from './image'
import { scheduleRelative, scheduleCron, cancelTimer } from './cron'
import { speechToText } from './stt'
import { searchWeb } from './search'
import { loadSession, saveSession, deleteSession } from './persist'
import path from 'path'
import fs from 'fs/promises'

const sessions = new Map<number, ChatSession>()
let bot: Telegraf
const lastScheduleAt = new Map<number, number>()

async function sendAudio(ctx: Context, filePath: string, caption?: string) {
  const buf = await fs.readFile(filePath)
  await ctx.replyWithAudio({ source: buf }, caption ? { caption } : {})
  await fs.unlink(filePath).catch(() => {})
}

async function handleAiResponse(ctx: Context, userId: number, text: string, useVoice = false): Promise<string> {
  let session = sessions.get(userId)
  if (!session) {
    const saved = await loadSession(String(userId))
    session = saved || { userId, history: [], lastActive: Date.now() }
    sessions.set(userId, session)
  }

  session.history.push({ role: 'user', text })
  await ctx.sendChatAction('typing')
  const { text: reply, toolCalls } = await askGemini(text, session.history.slice(0, -1))
  session.history.push({ role: 'model', text: reply })
  if (session.history.length > 20) session.history = session.history.slice(-20)
  await saveSession(String(userId), session)

  const isReminderRequest = /(ingat|remind)/i.test(text)
  const filteredTools = toolCalls.filter(t => {
    if (t.name !== 'schedule') return true
    const prev = lastScheduleAt.get(userId)
    if (prev && Date.now() - prev < 60000 && !isReminderRequest) return false
    return true
  })

  let replied = false
  for (const tool of filteredTools) {
    try {
      switch (tool.name) {
        case 'generate_image': {
          await ctx.sendChatAction('upload_photo')
          const file = await generateImage(tool.args.prompt)
          await ctx.replyWithPhoto({ source: file }, reply ? { caption: reply } : {})
          replied = true
          break
        }
        case 'text_to_speech': {
          await ctx.sendChatAction('upload_voice')
          const file = await textToSpeech(tool.args.text)
          await sendAudio(ctx, file, reply || '')
          replied = true
          break
        }
        case 'search': {
          await ctx.sendChatAction('typing')
          const results = await searchWeb(tool.args.query)
          const SUMMARIZE_PROMPT = 'Ringkas hasil pencarian ini. GUNAKAN HANYA URL yang benar-benar ada di hasil. JANGAN membuat URL palsu. JANGAN kasih catatan/referensi tambahan. Jika user minta link: tampilkan maksimal 2 link dari hasil. Jika info umum: jangan tampilkan link.'
          const { text: summarized } = await askGemini(
            `Hasil pencarian untuk "${tool.args.query}":\n${results}`,
            [],
            SUMMARIZE_PROMPT
          )
          if (useVoice) {
            await ctx.sendChatAction('record_voice')
            try {
              const audio = await textToSpeech(summarized)
              await sendAudio(ctx, audio)
            } catch { await ctx.reply(summarized) }
          } else {
            await ctx.reply(summarized)
          }
          session.history.push({ role: 'model', text: summarized })
          replied = true
          break
        }
        case 'schedule': {
          const sendReminder = async (msg: string) => {
            try { await bot.telegram.sendMessage(userId, msg) } catch { }
          }
          let scheduled = false
          if (tool.args.cron) { scheduleCron(userId, tool.args.cron, tool.args.message, sendReminder); scheduled = true }
          else if (tool.args.at) {
            const [h, m] = tool.args.at.split(':')
            if (h && m) { scheduleCron(userId, `${m} ${h} * * *`, tool.args.message, sendReminder); scheduled = true }
          } else if (tool.args.in) {
            const ms = parseRelativeTime(tool.args.in)
            if (ms > 0) { scheduleRelative(userId, ms, tool.args.message, sendReminder); scheduled = true }
          }
          if (!scheduled) break
          lastScheduleAt.set(userId, Date.now())
          const reminderReply = reply || tool.args.message
          if (useVoice) {
            try {
              const audio = await textToSpeech(reminderReply)
              await sendAudio(ctx, audio)
            } catch { await ctx.reply(reminderReply) }
          } else {
            await ctx.reply(reminderReply)
          }
          replied = true
          break
        }
      }
    } catch (err) {
      console.error(`Tool ${tool.name} error:`, err)
      replied = true
    }
  }

  if (!replied && reply) {
    if (useVoice) {
      await ctx.sendChatAction('record_voice')
      try {
        const audio = await textToSpeech(reply)
        await sendAudio(ctx, audio)
      } catch {
        await ctx.reply(reply)
      }
    } else {
      await ctx.reply(reply)
    }
  }

  return reply
}

export function createBot(): Telegraf {
  bot = new Telegraf(config.telegramToken)

  bot.start(async (ctx) => {
    sessions.set(ctx.from.id, { userId: ctx.from.id, history: [], lastActive: Date.now() })
    await ctx.reply(
      'Halo! Aku Asisten Hulenx.\n\n' +
      'Kemampuanku:\n' +
      '- Gambar: kirim "gambar kucing"\n' +
      '- Bacain teks: kirim "bacakan puisi"\n' +
      '- Ingatkan: kirim "ingatkan 5 menit lagi"\n' +
      '- Cari info: kirim "siapa presiden sekarang?"\n' +
      '- Cari link YouTube: kirim "cari link youtube lagu..."\n' +
      '- Voice note: kirim voice, aku jawab pake voice 🎤\n' +
      '- /cancel batalkan reminder\n' +
      '- /reset hapus memory obrolan'
    )
  })

  bot.command('cancel', async (ctx) => {
    cancelTimer(ctx.from.id)
    await ctx.reply('Semua reminder dibatalkan.')
  })

  bot.command('reset', async (ctx) => {
    const uid = ctx.from.id
    sessions.delete(uid)
    await deleteSession(String(uid))
    await ctx.reply('Memori obrolan dibersihkan. Aku lupa semuanya! Mulai obrolan baru yuk.')
  })

  bot.on('voice', async (ctx) => {
    const userId = ctx.from.id
    const fileLink = await ctx.telegram.getFileLink(ctx.message.voice.file_id)

    await ctx.sendChatAction('typing')
    const resp = await fetch(fileLink.href)
    const buf = Buffer.from(await resp.arrayBuffer())

    const tmpDir = path.join(process.cwd(), 'output')
    await fs.mkdir(tmpDir, { recursive: true })
    const tmpPath = path.join(tmpDir, `voice_${userId}_${Date.now()}.ogg`)
    await fs.writeFile(tmpPath, buf)

    try {
      const text = await speechToText(tmpPath)
      await handleAiResponse(ctx, userId, text, true)
    } catch (err) {
      console.error('STT error:', err)
      await ctx.reply('Gagal memproses voice note.')
    } finally {
      await fs.unlink(tmpPath).catch(() => {})
    }
  })

  bot.on('photo', async (ctx) => {
    const caption = ctx.message.caption || ''
    await handleAiResponse(ctx, ctx.from.id, caption || 'gambar')
  })

  bot.on('text', async (ctx) => {
    const text = ctx.message.text.toLowerCase()
    if (text === 'hapus memory' || text === 'reset memory') {
      sessions.delete(ctx.from.id)
      await deleteSession(String(ctx.from.id))
      await ctx.reply('Memori obrolan dibersihkan. Aku lupa semuanya! Mulai obrolan baru yuk.')
      return
    }
    await handleAiResponse(ctx, ctx.from.id, ctx.message.text)
  })

  return bot
}

function parseRelativeTime(input: string): number {
  const match = input.match(/(\d+)\s*(menit|detik|jam|hari)/i)
  if (!match) return 0
  const num = parseInt(match[1])
  const unit = match[2].toLowerCase()
  const multipliers: Record<string, number> = { detik: 1, menit: 60, jam: 3600, hari: 86400 }
  return num * (multipliers[unit] || 0) * 1000
}
