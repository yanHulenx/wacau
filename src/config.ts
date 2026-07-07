import dotenv from 'dotenv'
dotenv.config()

function required(key: string): string {
  const val = process.env[key]
  if (!val) {
    throw new Error(`Missing required env var: ${key}. Cek file .env`)
  }
  return val
}

export const config = {
  telegramToken: required('TELEGRAM_BOT_TOKEN'),
  groqApiKey1: required('GROQ_API_KEY_1'),
  groqApiKey2: required('GROQ_API_KEY_2'),
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  tavilyApiKey: required('TAVILY_API_KEY'),
  groqModelVersatile: process.env.GROQ_MODEL_VERSATILE || 'llama-3.3-70b-versatile',
  groqModelInstant: process.env.GROQ_MODEL_INSTANT || 'llama-3.3-70b-instant',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  port: parseInt(process.env.PORT || '3000', 10),
}
