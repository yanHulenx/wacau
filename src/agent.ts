import { ToolCall } from './types'

// ========== TOOLS / FUNCTIONS YANG BISA DIPANGGIL AI ==========
const tools: ToolCall[] = [
  {
    name: 'get_time',
    description: 'Mendapatkan waktu saat ini',
    handler: async () => {
      return `Sekarang: ${new Date().toLocaleString('id-ID')}`
    },
  },
  {
    name: 'calculator',
    description: 'Menghitung ekspresi matematika sederhana. Contoh: 2 + 2 * 3',
    handler: async (args) => {
      const expr = (args.expression as string) || ''
      try {
        const result = Function(`"use strict"; return (${expr})`)()
        return `Hasil: ${result}`
      } catch {
        return 'Ekspresi tidak valid'
      }
    },
  },
]

export function getToolDescriptions(): string {
  return tools
    .map((t) => `- ${t.name}: ${t.description}`)
    .join('\n')
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const tool = tools.find((t) => t.name === name)
  if (!tool) return `Tool "${name}" tidak ditemukan`
  return tool.handler(args)
}

// Prompt builder supaya AI paham bisa panggil tools
export function buildSystemPrompt(): string {
  return (
    'Kamu adalah Hulenx, AI assistant yang membantu user.\n' +
    'Gunakan bahasa Indonesia.\n' +
    'Jawab dengan ramah, informatif, dan to the point.\n\n' +
    'Kamu punya akses ke tools berikut:\n' +
    getToolDescriptions() +
    '\n\n' +
    'Kalau user minta sesuatu yang bisa di-handle tool, ' +
    'jawab dengan format:\n' +
    'TOOL_CALL: <nama_tool> | <args_json>\n' +
    'Lalu tunggu hasilnya sebelum lanjut ngobrol.'
  )
}
