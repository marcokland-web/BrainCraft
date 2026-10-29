// Bug-Bodo: Tests für compressImage (src/lib/images.ts) in Chromium und WebKit (Safari).
// Aufruf:  node tests/images.spec.mjs
// Startet selbst einen Vite-Dev-Server auf Port 8793, lädt das Modul per dynamischem Import
// und beendet den Server am Ende. Playwright kommt aus ~/Apps/DasTeam/tools.
// Ergebnis: Exit-Code 0 = alles bestanden, 1 = mindestens ein Fehler.

import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PW = process.env.PLAYWRIGHT_DIR ?? join(homedir(), 'Apps/DasTeam/tools/node_modules/playwright')
const { chromium, webkit } = createRequire(import.meta.url)(PW)
const PORT = 8793
const URL = `http://localhost:${PORT}/BrainCraft/`

// ---------- Dev-Server ----------
function startServer() {
  const p = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'pipe', detached: true })
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('Dev-Server startet nicht')), 30000)
    const on = (d) => { if (String(d).includes(String(PORT))) { clearTimeout(t); res(p) } }
    p.stdout.on('data', on); p.stderr.on('data', on)
    p.on('exit', (c) => rej(new Error('Dev-Server beendet: ' + c)))
  })
}
const stopServer = (p) => { try { process.kill(-p.pid, 'SIGTERM') } catch {} }

// ---------- Tests im Browser ----------
// Läuft in der Seite. Gibt eine Liste {name, ok, detail} zurück.
async function inPage(heicB64) {
  const mod = await import('/BrainCraft/src/lib/images.ts')
  const { compressImage, ImageError, MAX_SIDE, TARGET_BYTES } = mod

  // toBlob mitschneiden: welche Stufen probiert compressImage?
  const log = []
  const orig = HTMLCanvasElement.prototype.toBlob
  HTMLCanvasElement.prototype.toBlob = function (cb, type, q) {
    const c = this
    return orig.call(this, (b) => {
      // __fake: jede Stufe liefert 1 Byte zu viel -> prüft den Weg bis too_large
      if (window.__fake && b) b = new Blob([new Uint8Array(TARGET_BYTES + 1)], { type: 'image/jpeg' })
      if (window.__rec) log.push({ w: c.width, h: c.height, q, size: b?.size }); cb(b)
    }, type, q)
  }
  const blobOf = (canvas, type, q) => new Promise((r) => orig.call(canvas, r, type, q))

  function canvas(w, h, paint) {
    const c = document.createElement('canvas'); c.width = w; c.height = h
    paint(c.getContext('2d'), w, h); return c
  }
  const plain = (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#7A1E3A'); g.addColorStop(1, '#C8963E')
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = '#fff'; ctx.font = `${Math.round(h / 10)}px sans-serif`; ctx.fillText('Heft', w / 10, h / 2)
  }
  const noise = (amp) => (ctx, w, h) => {
    plain(ctx, w, h)
    const d = ctx.getImageData(0, 0, w, h), a = d.data
    let s = 12345 // fester Startwert -> wiederholbar
    const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296)
    for (let i = 0; i < a.length; i += 4) {
      a[i] = Math.max(0, Math.min(255, a[i] + (rnd() - 0.5) * amp))
      a[i + 1] = Math.max(0, Math.min(255, a[i + 1] + (rnd() - 0.5) * amp))
      a[i + 2] = Math.max(0, Math.min(255, a[i + 2] + (rnd() - 0.5) * amp))
    }
    ctx.putImageData(d, 0, 0)
  }
  async function info(blob) {
    const bm = await createImageBitmap(blob)
    const c = canvas(bm.width, bm.height, (ctx) => ctx.drawImage(bm, 0, 0))
    const px = (x, y) => Array.from(c.getContext('2d').getImageData(x, y, 1, 1).data.slice(0, 3))
    const r = { w: bm.width, h: bm.height, px }
    bm.close(); return r
  }
  async function run(file) {
    log.length = 0; window.__rec = true
    const t0 = performance.now()
    try {
      const out = await compressImage(file)
      return { out, ms: Math.round(performance.now() - t0), steps: log.slice() }
    } catch (e) {
      return { err: e instanceof ImageError ? e.code : 'ANDERER FEHLER: ' + e, ms: Math.round(performance.now() - t0), steps: log.slice() }
    } finally { window.__rec = false }
  }
  const results = []
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail })
  const stepsTxt = (s) => s.map((x) => `${Math.max(x.w, x.h)}px@${x.q}=${Math.round(x.size / 1024)}KB`).join(' > ')
  // Erwartete Reihenfolge der Stufen
  const ORDER = []
  for (const side of [1600, 1280, 1024]) for (const q of [0.8, 0.7, 0.6]) ORDER.push({ side, q })
  const orderOk = (steps, w0, h0) => steps.every((s, i) => {
    const e = ORDER[i]; const sc = Math.min(1, e.side / Math.max(w0, h0))
    return s.q === e.q && s.w === Math.max(1, Math.round(w0 * sc)) && s.h === Math.max(1, Math.round(h0 * sc))
  }) && steps.slice(0, -1).every((s) => s.size > TARGET_BYTES)

  check('Konstanten MAX_SIDE=1600, TARGET_BYTES=819200', MAX_SIDE === 1600 && TARGET_BYTES === 819200, `${MAX_SIDE}/${TARGET_BYTES}`)

  // 1/2: Hoch- und Querformat (Handyfoto 4032×3024)
  for (const [name, w, h, ew, eh] of [['Querformat 4032×3024', 4032, 3024, 1600, 1200], ['Hochformat 3024×4032', 3024, 4032, 1200, 1600]]) {
    const src = await blobOf(canvas(w, h, plain), 'image/jpeg', 0.92)
    const r = await run(new File([src], 'foto.jpg', { type: 'image/jpeg' }))
    if (r.err) { check(name, false, r.err); continue }
    const i = await info(r.out)
    check(name, r.out.type === 'image/jpeg' && i.w === ew && i.h === eh && r.out.size <= TARGET_BYTES && r.steps.length === 1 && r.steps[0].q === 0.8,
      `${w}×${h} -> ${i.w}×${i.h}, ${r.out.type}, ${Math.round(r.out.size / 1024)} KB, Stufen: ${stepsTxt(r.steps)}, ${r.ms} ms`)
  }
  // Panorama und Grenzfälle
  for (const [name, w, h, ew, eh] of [['Panorama 8000×1000', 8000, 1000, 1600, 200], ['genau 1600×1200', 1600, 1200, 1600, 1200], ['1601×1 (Höhe darf nicht 0 werden)', 1601, 1, 1600, 1], ['1×1', 1, 1, 1, 1]]) {
    const src = await blobOf(canvas(w, h, plain), 'image/png')
    const r = await run(new File([src], 'x.png', { type: 'image/png' }))
    if (r.err) { check(name, false, r.err); continue }
    const i = await info(r.out)
    check(name, i.w === ew && i.h === eh, `-> ${i.w}×${i.h}, ${Math.round(r.out.size / 1024)} KB`)
  }

  // 3: kleines Bild wird nicht vergrößert
  {
    const src = await blobOf(canvas(800, 600, plain), 'image/jpeg', 0.92)
    const r = await run(new File([src], 'klein.jpg', { type: 'image/jpeg' }))
    const i = r.err ? null : await info(r.out)
    check('klein 800×600 bleibt 800×600', i && i.w === 800 && i.h === 600, r.err ?? `-> ${i.w}×${i.h}, ${Math.round(r.out.size / 1024)} KB`)
  }

  // 4: PNG mit Transparenz -> weißer Grund
  {
    const src = await blobOf(canvas(1000, 800, (ctx) => { ctx.fillStyle = '#7A1E3A'; ctx.fillRect(0, 0, 200, 200) }), 'image/png')
    const r = await run(new File([src], 'trans.png', { type: 'image/png' }))
    if (r.err) check('PNG transparent -> weiß', false, r.err)
    else {
      const i = await info(r.out); const bg = i.px(800, 600); const fg = i.px(50, 50)
      check('PNG transparent -> weiß', r.out.type === 'image/jpeg' && bg.every((v) => v >= 250) && fg[0] > 100 && fg[1] < 60,
        `Grund ${bg}, Fläche ${fg}, ${i.w}×${i.h}`)
    }
  }

  // 5: Rauschen -> Stufen greifen. Jeder Fall: Reihenfolge stimmt, Ergebnis <= 800 KB.
  // Wie viele Stufen nötig sind, hängt vom JPEG-Encoder ab (WebKit erzeugt etwa 2-3x größere Dateien).
  let maxSteps = 0
  for (const [w, h, amp, label] of [[4032, 3024, 90, 'mittleres Rauschen 4032×3024'], [4032, 3024, 255, 'volles Rauschen 4032×3024'], [3000, 3000, 255, 'volles Rauschen 3000×3000']]) {
    // Quadrat als PNG (verlustfrei, damit das Rauschen nicht schon in der Quelle geglättet ist)
    const png = w === h
    const src = await blobOf(canvas(w, h, noise(amp)), png ? 'image/png' : 'image/jpeg', 0.95)
    const r = await run(new File([src], png ? 'rauschen.png' : 'rauschen.jpg', { type: src.type }))
    maxSteps = Math.max(maxSteps, r.steps.length)
    const detail = `Quelle ${Math.round(src.size / 1024)} KB, Stufen: ${stepsTxt(r.steps)}, Ergebnis: ${r.err ?? Math.round(r.out.size / 1024) + ' KB'}, ${r.ms} ms`
    const ok = orderOk(r.steps, w, h) && (r.err ? r.err === 'too_large' && r.steps.length === 9 : r.out.size <= TARGET_BYTES)
    check(`${label}: Stufen in richtiger Reihenfolge, Ergebnis <= 800 KB`, ok, detail)
  }
  check('Rauschen: Verkleinerungsstufe 1280 px wurde erreicht', maxSteps >= 4, `höchstens ${maxSteps} Versuche`)
  // too_large: echt kaum erreichbar, daher Encoder-Ergebnis künstlich zu groß machen
  {
    const src = await blobOf(canvas(4032, 3024, plain), 'image/jpeg', 0.9)
    window.__fake = true
    const r = await run(new File([src], 'zu-gross.jpg', { type: 'image/jpeg' }))
    window.__fake = false
    check('alle 9 Stufen zu groß -> too_large', r.err === 'too_large' && r.steps.length === 9 && orderOk(r.steps, 4032, 3024),
      `${r.err ?? 'kein Fehler'}, Versuche: ${r.steps.map((x) => Math.max(x.w, x.h) + '@' + x.q).join(' ')}`)
  }

  // 6: Nicht-Bild
  {
    const r = await run(new File(['Hallo, ich bin kein Bild'], 'text.txt', { type: 'text/plain' }))
    check('Nicht-Bild (text/plain) -> not_image', r.err === 'not_image', r.err ?? 'kein Fehler')
    const r2 = await run(new File(['%PDF-1.4 ...'], 'heft.pdf', { type: 'application/pdf' }))
    check('PDF -> not_image', r2.err === 'not_image', r2.err ?? 'kein Fehler')
    const r3 = await run(new Blob(['Hallo, ich bin kein Bild']))
    // Ohne MIME-Typ wird bewusst ein Dekodierversuch gemacht -> decode_failed ist hier in Ordnung
    check('Nicht-Bild ohne MIME-Typ -> not_image oder decode_failed', ['not_image', 'decode_failed'].includes(r3.err), r3.err ?? 'kein Fehler')
  }

  // 7: kaputte Datei
  {
    const good = new Uint8Array(await (await blobOf(canvas(400, 300, plain), 'image/jpeg', 0.9)).arrayBuffer())
    const r = await run(new File([good.slice(0, 40)], 'kaputt.jpg', { type: 'image/jpeg' }))
    check('abgeschnittenes JPEG -> decode_failed', r.err === 'decode_failed', r.err ?? `kein Fehler, ${r.out?.size} B`)
    const r2 = await run(new File([new Uint8Array(5000).fill(7)], 'muell.jpg', { type: 'image/jpeg' }))
    check('Müll-Bytes als image/jpeg -> decode_failed', r2.err === 'decode_failed', r2.err ?? 'kein Fehler')
    const r3 = await run(new File([], 'leer.png', { type: 'image/png' }))
    check('leere Datei -> decode_failed', r3.err === 'decode_failed', r3.err ?? 'kein Fehler')
  }

  // 8: EXIF-Drehung (Orientation 6 = 90° im Uhrzeigersinn)
  {
    // 400×200: links rot, rechts blau. Nach Drehung um 90° im UZS: 200×400, oben rot, unten blau.
    const c = canvas(400, 200, (ctx) => { ctx.fillStyle = '#f00'; ctx.fillRect(0, 0, 200, 200); ctx.fillStyle = '#00f'; ctx.fillRect(200, 0, 200, 200) })
    const jpg = new Uint8Array(await (await blobOf(c, 'image/jpeg', 0.95)).arrayBuffer())
    // APP1/Exif mit IFD0, einem Eintrag: Orientation (0x0112) SHORT = 6, Big Endian
    const tiff = [0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0]
    const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
    const len = body.length + 2
    const app1 = [0xff, 0xe1, len >> 8, len & 255, ...body]
    // Nach SOI einsetzen; ein vorhandenes APP0 (JFIF) bleibt dahinter, das ist erlaubt
    const withExif = new Uint8Array([...jpg.slice(0, 2), ...app1, ...jpg.slice(2)])
    const r = await run(new File([withExif], 'exif6.jpg', { type: 'image/jpeg' }))
    if (r.err) check('EXIF Orientation 6 wird gedreht', false, r.err)
    else {
      const i = await info(r.out); const top = i.px(100, 50), bottom = i.px(100, 350)
      check('EXIF Orientation 6 wird gedreht', i.w === 200 && i.h === 400 && top[0] > 200 && top[2] < 60 && bottom[2] > 200 && bottom[0] < 60,
        `-> ${i.w}×${i.h}, oben ${top}, unten ${bottom}`)
    }
  }

  // 9: HEIC (iPhone-Standardformat), nur wenn vorhanden
  if (heicB64) {
    const bin = Uint8Array.from(atob(heicB64), (ch) => ch.charCodeAt(0))
    const r = await run(new File([bin], 'IMG_0001.HEIC', { type: 'image/heic' }))
    results.push({ name: 'HEIC 2000×1500 (Hinweis, kein Pflichtfall)', ok: !r.err, info: true,
      detail: r.err ?? `-> ${(await info(r.out)).w}px breit, ${Math.round(r.out.size / 1024)} KB` })
  }
  return results
}

// ---------- Ablauf ----------
let server
let failed = 0
try {
  // HEIC-Testbild mit sips (macOS), falls möglich
  let heicB64 = null
  try {
    const dir = mkdtempSync(join(tmpdir(), 'bc-heic-'))
    const src = join(ROOT, 'public/icons/icon-512.png'); const heic = join(dir, 'a.heic')
    if (existsSync(src)) {
      execFileSync('sips', ['-s', 'format', 'heic', '-z', '1500', '2000', src, '--out', heic], { stdio: 'ignore' })
      heicB64 = readFileSync(heic).toString('base64')
    }
  } catch {}

  server = await startServer()
  for (const [bname, type] of [['Chromium', chromium], ['WebKit (Safari)', webkit]]) {
    let browser
    try { browser = await type.launch() } catch (e) { console.log(`\n## ${bname}: NICHT GEPRÜFT (${String(e).split('\n')[0]})`); continue }
    const page = await browser.newPage()
    await page.goto(URL)
    const res = await page.evaluate(inPage, heicB64)
    console.log(`\n## ${bname}`)
    for (const r of res) {
      const mark = r.ok ? 'OK    ' : r.info ? 'HINWEIS' : 'FEHLER'
      if (!r.ok && !r.info) failed++
      console.log(`${mark} ${r.name}: ${r.detail}`)
    }
    await browser.close()
  }
} finally {
  if (server) stopServer(server)
}
console.log(failed ? `\n${failed} Fehler` : '\nAlle Tests bestanden')
process.exit(failed ? 1 : 0)
