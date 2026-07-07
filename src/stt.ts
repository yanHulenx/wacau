import fs from 'fs'
import { config } from './config'
import Groq from 'groq-sdk'

const groq = new Groq({ apiKey: config.groqApiKey1 })

export async function speechToText(audioPath: string): Promise<string> {
  const transcription = await groq.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: 'whisper-large-v3',
    language: 'id',
  })

  return transcription.text || ''
}
