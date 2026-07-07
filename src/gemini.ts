import Groq from "groq-sdk";
import { GoogleGenAI } from "@google/genai";
import { config } from "./config";

let groqClients: Groq[] = [];
let geminiClient: GoogleGenAI | null = null;

export function initGemini() {
  groqClients = [
    new Groq({ apiKey: config.groqApiKey1 }),
    new Groq({ apiKey: config.groqApiKey2 }),
  ];
  if (config.geminiApiKey) {
    geminiClient = new GoogleGenAI({ apiKey: config.geminiApiKey });
  }
}

export interface ToolCall {
  name: string;
  args: Record<string, string>;
}

const SYSTEM_PROMPT = `Kamu adalah Hulenx, temen ngobrol yang asik — bukan AI kaku. Cowok 25 tahun, tinggal di Bekasi, suka ngopi sambil ngeliatin hujan. Ngomongnya santai, pake bahasa sehari-hari campur aduk (Indonesia, Sunda, Inggris, atau bahasa apapun yang dipake lawan bicara). Jawab natural, kayak lagi chat di WA sama temen — nggak usah kaku, nggak usah formal. Kalo lagi becanda ya becanda, kalo lagi serius ya serius.

PENTING: Jawabnya yang pendek aja, kayak chat WA beneran. 1-3 kalimat doang, nggak usah panjang lebar kaya novel. Kecuali kalo user minta cerita atau penjelasan detail, baru boleh panjang.

YANG BISA KAMU LAKUKAN:
1. [TOOL: generate_image | prompt: deskripsi] → bikin gambar. Kalo user minta gambar, langsung bikin aja.
2. [TOOL: text_to_speech | text: teks] → bacain teks. PAKE INI CUMA KALO DIMINTA. Bukan buat voice chat/voice note.
3. [TOOL: schedule | in: 5 menit | message: pesan] → bikin pengingat. Kalo user selesai minta reminder, lanjut ngobrol biasa.
4. [TOOL: search | query: teks pencarian] → cari informasi. WAJIB dipake buat SEMUA info faktual: berita, harga, juara, siapa/kapan/dimana, link YouTube, dll.

SOAL LINK: kalo user nanya link, pastikan beneran dari hasil search. JANGAN asal buat URL palsu.

SOAL VOICE NOTE: kalo user kirim voice note, itu udah otomatis diubah jadi teks. Jawab aja biasa. JANGAN panggil text_to_speech tool buat voice chat.

SOAL WAKTU: di setiap chat, kamu dikasih tau waktu saat ini di sistem. Tapi JANGAN PERNAH nyebutin jam/tanggal/hari ke user kalo nggak ditanya. Kalaupun ditanya "sekarang jam berapa", jawab pendek aja. Nggak usah ditambah "hari ini hari ... cuaca cerah" dll.

KEMAMPUAN MEMBUAT CERITA DRAMA:
Jika user minta dibuatkan cerita/drama/kisah/novel, kamu WAJIB MENULIS NARASI CERITANYA LANGSUNG — BUKAN CUMA OUTLINE/RINGKASAN ALUR. Tulislah cerita berbentuk prosa naratif seperti contoh di bawah, bukan daftar bullet point atau bagian skenario.

CONTOH GAYA NARASI YANG HARUS DITIRU:
"Bunyi weer masih 3 jam lagi. Tapi aku terbangun tiba-tiba seperti dipotong dari sebuah mimpi yang sudah kusisakan detailnya. Kamar gelap hanya remang-remang lampu taman yang menyelinap dari celah gorden tebal. Di sebelahku, dia mendengkur pelan... Wangi yang asing. Bukan wangi parfumku. Ini wangi yang manis, terlalu manis seperti bunga fresia dan buah pir yang overri. Wangi yang mencoba keras untuk elegan, tapi justru terkesan desperado."

Ciri khas gaya yang WAJIB ditiru:
- NARASI PROSA PANJANG, bukan outline/poin-poin
- Deskriptif pakai indera (bau, suara, visual, sentuhan)
- Banyak metafora dan simile
- Sudut pandang orang pertama (aku)
- Kalimat fragmentasi dan elipsis (...) untuk dramatisasi
- Fokus ke perasaan & pikiran tokoh
- Dialog natural, alur lambat dan detail
- Klimaks menegangkan, resolusi di akhir

ATURAN BERSERI (PART):
- Jika cerita sangat panjang, JANGAN selesaikan dalam 1 jawaban.
- TULIS NARASI BAGIAN 1 langsung (prosa, bukan outline), akhiri dengan "[LANJUT KE BAGIAN 2]"
- Saat user minta lanjut, tulis narasi BAGIAN 2 langsung lanjutan cerita
- Setiap bagian tetap panjang dan mendetail
- Akhiri dengan **TAMAT**`;

const TIME_FORMATTER = new Intl.DateTimeFormat("id-ID", {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Jakarta",
});

type GroqMessage = { role: "user" | "assistant" | "system"; content: string };

function isRateLimitError(err: any): boolean {
  if (!err) return false;
  if (err.status === 429 || err.status === 413) return true;
  const msg = (err.message || "").toLowerCase();
  return (
    msg.includes("rate_limit") ||
    msg.includes("rate limit") ||
    msg.includes("quota") ||
    msg.includes("429") ||
    msg.includes("413") ||
    msg.includes("resource_exhausted") ||
    msg.includes("too large")
  );
}

async function tryGroq(
  client: Groq,
  model: string,
  messages: GroqMessage[],
): Promise<string | null> {
  try {
    const completion = await client.chat.completions.create({
      model,
      messages,
      max_tokens: 300,
    });
    return completion.choices[0]?.message?.content ?? "";
  } catch (err: any) {
    console.warn(`[Groq ${model}] Error: ${err.message}`);
    if (isRateLimitError(err)) return null;
    return null;
  }
}

async function tryGemini(
  messages: GroqMessage[],
  systemPrompt: string,
): Promise<string | null> {
  if (!geminiClient) return null;
  try {
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
    const response = await geminiClient.models.generateContent({
      model: config.geminiModel,
      contents,
      config: {
        systemInstruction: systemPrompt,
        maxOutputTokens: 300,
      },
    });
    return response.text || "";
  } catch (err: any) {
    console.warn(`[Gemini] Error: ${err.message}`);
    if (isRateLimitError(err)) return null;
    return null;
  }
}

function parseResponse(content: string): {
  text: string;
  toolCalls: ToolCall[];
} {
  const cleanThink = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const toolCalls: ToolCall[] = [];
  const toolRegex = /\[TOOL:\s*(\w+)\s*\|\s*((?:[^|]+(?:\|[^|]+)*?))\]/gi;
  let match: RegExpExecArray | null;
  while ((match = toolRegex.exec(cleanThink)) !== null) {
    const name = match[1].trim();
    const argsStr = match[2];
    const args: Record<string, string> = {};
    argsStr.split("|").forEach((part) => {
      const [k, ...v] = part.trim().split(":");
      if (k && v.length) args[k.trim()] = v.join(":").trim();
    });
    toolCalls.push({ name, args });
  }
  const cleanText = cleanThink.replace(toolRegex, "").trim();
  return { text: cleanText, toolCalls };
}

export async function askGemini(
  prompt: string,
  history: { role: "user" | "model"; text: string }[] = [],
  systemOverride?: string,
): Promise<{ text: string; toolCalls: ToolCall[] }> {
  const now = TIME_FORMATTER.format(new Date());
  const systemPrompt =
    (systemOverride || SYSTEM_PROMPT) + `\n\nWaktu saat ini: ${now} WIB`;

  const messages: GroqMessage[] = history.map((h) => ({
    role: h.role === "model" ? "assistant" : "user",
    content: h.text,
  }));

  messages.push({
    role: "user",
    content: prompt,
  });

  const providerChain: { name: string; call: () => Promise<string | null> }[] =
    [];

  providerChain.push({
    name: `GEMINI ${config.geminiModel}`,
    call: () =>
      tryGemini(
        [{ role: "system", content: systemPrompt }, ...messages],
        systemPrompt,
      ),
  });

  for (const [idx, client] of groqClients.entries()) {
    const label = `GROQ-${idx + 1}`;
    providerChain.push({
      name: `${label} ${config.groqModelVersatile}`,
      call: () =>
        tryGroq(client, config.groqModelVersatile, [
          { role: "system", content: systemPrompt },
          ...messages,
        ]),
    });
    providerChain.push({
      name: `${label} ${config.groqModelInstant}`,
      call: () =>
        tryGroq(client, config.groqModelInstant, [
          { role: "system", content: systemPrompt },
          ...messages,
        ]),
    });
  }

  let attempt = 0;
  while (true) {
    attempt++;
    for (const provider of providerChain) {
      const result = await provider.call();
      if (result !== null) return parseResponse(result);
      console.log(`[${provider.name}] gagal, lanjut provider berikutnya...`);
    }
    console.log(
      `[Fallback] Semua provider habis (attempt ${attempt}), looping kembali ke GROQ-1...`,
    );
    await new Promise((r) => setTimeout(r, 2000));
  }
}
