import { compressImage } from './images'

// Scan einer Klassenarbeit über die Edge Function bc-extract:
// verkleinern → Auftrag anlegen → Fotos hochladen → je Foto analysieren → zusammenführen → Fotos löschen.
// Übernommen werden die Fragen danach über bc_unit_import (Status „entwurf“).

const SUPABASE_URL = 'https://asfwbuptsfcrgmmgdgim.supabase.co'
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/bc-extract`
// Öffentlicher Schlüssel (publishable), wie in Rechenstern; die Rechte liegen in den bc_*-Funktionen
const PUBLISHABLE_KEY = 'sb_publishable_uXsPWezRtId6Eh3Dme7BcQ_mQzAx6Se'

export interface Slide {
  title: string
  content: string
  keywords: string[]
}
export interface ScanQuestion {
  type: string
  prompt: string
  payload: Record<string, unknown>
}
export interface ScanResult {
  summary_slides: Slide[]
  questions: ScanQuestion[]
  dropped: number
}

export type ScanStep =
  | { step: 'compress'; done: number; total: number }
  | { step: 'upload'; done: number; total: number }
  | { step: 'analyze'; done: number; total: number }
  | { step: 'merge' }

export class ScanError extends Error {
  constructor(public code: string) {
    super(code)
  }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: PUBLISHABLE_KEY },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({ error: 'bad_response' }))
  if (!res.ok || data.error) throw new ScanError(data.error ?? 'server_error')
  return data as T
}

export async function scanExam(
  auth: { code: string; token: string },
  examId: string,
  files: File[],
  onStep: (s: ScanStep) => void,
): Promise<{ jobId: string; result: ScanResult }> {
  if (files.length < 1 || files.length > 10) throw new ScanError('bad_image_count')

  const images: Blob[] = []
  for (const f of files) {
    onStep({ step: 'compress', done: images.length, total: files.length })
    images.push(await compressImage(f))
  }

  const start = await call<{ ticket: string; job_id: string; uploads: { index: number; url: string }[] }>({
    action: 'start',
    ...auth,
    exam_id: examId,
    count: images.length,
  })
  const finish = (ok: boolean, error?: string) =>
    call({ action: 'finish', ...auth, ticket: start.ticket, ok, error }).catch(() => undefined)

  try {
    for (const u of start.uploads) {
      onStep({ step: 'upload', done: u.index, total: images.length })
      const res = await fetch(u.url, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: images[u.index],
      })
      if (!res.ok) throw new ScanError('upload_failed')
    }

    const pages: ScanResult[] = []
    for (let i = 0; i < images.length; i++) {
      onStep({ step: 'analyze', done: i, total: images.length })
      pages.push(await call<ScanResult>({ action: 'analyze', ...auth, ticket: start.ticket, index: i }))
    }

    onStep({ step: 'merge' })
    const result = await call<ScanResult>({ action: 'merge', ...auth, ticket: start.ticket, pages })
    await finish(true)
    return { jobId: start.job_id, result }
  } catch (e) {
    await finish(false, e instanceof ScanError ? e.code : 'client_error')
    throw e
  }
}
