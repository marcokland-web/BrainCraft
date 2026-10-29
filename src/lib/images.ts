// Fotos vor dem Hochladen verkleinern (wichtig für Safari/iOS):
// längste Seite höchstens 1600 px, JPEG mit 80 %, Ziel unter 800 KB.
// Reicht das nicht, wird erst die Qualität, dann die Größe schrittweise gesenkt.

export const MAX_SIDE = 1600
export const TARGET_BYTES = 800 * 1024
const QUALITIES = [0.8, 0.7, 0.6]

export class ImageError extends Error {
  constructor(public code: 'not_image' | 'decode_failed' | 'too_large') {
    super(code)
  }
}

async function decode(file: Blob): Promise<ImageBitmap> {
  if (file.type && !file.type.startsWith('image/')) throw new ImageError('not_image')
  try {
    // Dreht Handyfotos nach den EXIF-Angaben richtig herum
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new ImageError('decode_failed')
  }
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new ImageError('decode_failed'))), 'image/jpeg', quality),
  )
}

export async function compressImage(file: Blob): Promise<Blob> {
  const bitmap = await decode(file)
  let side = MAX_SIDE
  try {
    // Höchstens drei Verkleinerungsstufen (1600, 1280, 1024 px)
    for (let step = 0; step < 3; step++) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new ImageError('decode_failed')
      // Weißer Grund, falls ein PNG Transparenz hat
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      for (const q of QUALITIES) {
        const blob = await toJpeg(canvas, q)
        if (blob.size <= TARGET_BYTES) return blob
      }
      side = Math.round(side * 0.8)
    }
  } finally {
    bitmap.close()
  }
  throw new ImageError('too_large')
}
