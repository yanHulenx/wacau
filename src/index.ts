import http from 'http'
import { config } from './config'
import { initGemini } from './gemini'
import { createBot } from './telegram'

async function main() {
  console.log('OpenClaw starting...')

  initGemini()
  console.log('Groq AI ready')

  const bot = createBot()
  bot.launch()
  console.log('Telegram bot running')

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('OpenClaw Telegram Bot is running!')
  })

  server.listen(config.port, () => {
    console.log(`Health check: http://localhost:${config.port}`)
  })

  console.log('Ready!')

  process.once('SIGINT', () => { bot.stop('SIGINT'); server.close(); process.exit(0) })
  process.once('SIGTERM', () => { bot.stop('SIGTERM'); server.close(); process.exit(0) })
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
