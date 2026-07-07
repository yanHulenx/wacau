import fs from 'fs/promises'
import path from 'path'

const outputDir = path.join(process.cwd(), 'output')

export async function generateImage(
  prompt: string,
  options?: {
    width?: number
    height?: number
    model?: string
  }
): Promise<string> {
  const { width = 1024, height = 1024, model = 'flux' } = options || {}

  const encoded = encodeURIComponent(prompt)
  const url = `https://image.pollinations.ai/prompt/${encoded}?model=${model}&width=${width}&height=${height}&nologo=true`

  await fs.mkdir(outputDir, { recursive: true })

  const response = await fetch(url)
  if (!response.ok) throw new Error(`Image API: ${response.status}`)

  const buffer = Buffer.from(await response.arrayBuffer())
  const filePath = path.join(outputDir, `img_${Date.now()}.jpg`)
  await fs.writeFile(filePath, buffer)

  return filePath
}
