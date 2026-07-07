import http from 'http'
import { config } from './config'
import { initGemini } from './gemini'
import { createBot } from './telegram'
import { startWaBot, getQrDataUrl } from './whatsapp'

async function main() {
  console.log('OpenClaw starting...')

  initGemini()
  console.log('Groq AI ready')

  const bot = createBot()
  bot.launch()
  console.log('Telegram bot running')

  startWaBot().catch(err => console.error('WA bot error:', err))

  const server = http.createServer((_req, res) => {
    const qr = getQrDataUrl()
    if (qr) {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(`<!DOCTYPE html>
<html>
<head><title>OpenClaw - WhatsApp QR</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f0f2f5;text-align:center}
.card{background:#fff;border-radius:16px;padding:40px;box-shadow:0 2px 12px rgba(0,0,0,.1);max-width:400px}
h1{color:#075e54;font-size:24px;margin:0 0 8px}
p{color:#667781;margin:0 0 24px;font-size:14px}
img{max-width:280px;border:1px solid #e9edef;border-radius:12px;padding:16px}
.footer{margin-top:24px;font-size:12px;color:#a0a0a0}
.status{display:inline-block;padding:4px 12px;border-radius:20px;font-size:13px;margin-top:16px}
.waiting{background:#fff3cd;color:#856404}
.ready{background:#d4edda;color:#155724}
</style></head>
<body>
<div class="card">
<h1>OpenClaw WhatsApp</h1>
<p>Scan QR ini dengan WhatsApp &gt; Perangkat Tertaut</p>
<img src="${qr}" alt="QR Code"/>
<p class="status waiting">Menunggu scan...</p>
<div class="footer">Auto-refresh setiap 5 detik</div>
</div>
<script>setTimeout(()=>location.reload(),5000)</script>
</body>
</html>`)
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(`<!DOCTYPE html>
<html>
<head><title>OpenClaw - WhatsApp QR</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f0f2f5;text-align:center}
.card{background:#fff;border-radius:16px;padding:40px;box-shadow:0 2px 12px rgba(0,0,0,.1);max-width:400px}
h1{color:#075e54;font-size:24px;margin:0 0 8px}
p{color:#667781;margin:16px 0}
</style></head>
<body>
<div class="card">
<h1>OpenClaw WhatsApp</h1>
<p class="status ready">WhatsApp sudah tersambung</p>
</div>
</body>
</html>`)
    }
  })

  server.listen(config.port, () => {
    console.log(`Web QR: http://localhost:${config.port}`)
  })

  console.log('Ready!')
  console.log('Telegram + WhatsApp aktif. Chat aja langsung!')

  process.once('SIGINT', () => { bot.stop('SIGINT'); server.close(); process.exit(0) })
  process.once('SIGTERM', () => { bot.stop('SIGTERM'); server.close(); process.exit(0) })
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
