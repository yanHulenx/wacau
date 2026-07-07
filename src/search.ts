import { tavily } from '@tavily/core'
import { config } from './config'

const client = tavily({ apiKey: config.tavilyApiKey })

export interface SearchResult {
  title: string
  url: string
  content: string
}

export async function searchWeb(query: string): Promise<string> {
  const response = await client.search(query, {
    searchDepth: 'basic',
    maxResults: 5,
  })

  if (!response.results || response.results.length === 0) {
    return 'Tidak ada hasil ditemukan.'
  }

  const clean = (s: string) => s.replace(/[_*#\[\]()~`>|\\]/g, '')
  return response.results
    .map((r, i) => `${i + 1}. ${clean(r.title)}\n${clean(r.content).substring(0, 100)}\n${r.url}`)
    .join('\n\n')
}
