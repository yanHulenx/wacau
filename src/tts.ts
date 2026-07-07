import { EdgeTTS } from 'node-edge-tts'
import path from 'path'

const outputDir = path.join(process.cwd(), 'output')

export async function textToSpeech(
  text: string,
  filename?: string
): Promise<string> {
  const tts = new EdgeTTS({
    voice: 'id-ID-ArdiNeural',
    lang: 'id-ID',
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
  })

  const fs = await import('fs/promises')
  await fs.mkdir(outputDir, { recursive: true })

  const filePath = path.join(outputDir, filename || `tts_${Date.now()}.mp3`)
  await tts.ttsPromise(text, filePath)
  return filePath
}
