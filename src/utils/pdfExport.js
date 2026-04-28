import { PDFDocument, PDFName } from 'pdf-lib'

/* ─── Helpers ─── */

// Format dates_picked array as "April 15, 16, 17, 2026"
function formatDatesPicked(dates) {
  if (!dates || dates.length === 0) return ''
  const parsed = dates.map(d => new Date(d + 'T00:00:00'))
  const month = parsed[0].toLocaleDateString('en-US', { month: 'long' })
  const year = parsed[0].getFullYear()
  const days = parsed.map(d => d.getDate())
  return `${month} ${days.join(', ')}, ${year}`
}

// Extract last name from full name
function lastName(fullName) {
  if (!fullName) return 'Unknown'
  const parts = fullName.trim().split(/\s+/)
  return parts[parts.length - 1]
}

// Trigger browser download of a Uint8Array as a file
function downloadPdf(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// Old format: data URL or suspiciously long string stored before the text-signature migration.
// Treat these as "no signature" rather than trying to render them.
function isLegacySignature(sig) {
  return !sig || sig.startsWith('data:') || sig.length > 200
}

// Render a typed name as cursive text on a transparent canvas and return raw base64 PNG.
// The canvas is sized to the actual text width so it scales efficiently in the PDF.
async function renderNameToCanvas(name) {
  const FONT_SIZE = 36
  const FONT = `italic ${FONT_SIZE}px "Dancing Script", cursive`
  const CANVAS_H = 80
  // Baseline at y=62 → 18px below for descenders (22.5% of height below baseline)
  const BASELINE_Y = 62
  const PAD = 10

  // Ensure font is loaded before measuring/drawing
  try { await document.fonts.load(FONT) } catch { /* use system cursive fallback */ }

  // Measure so the canvas exactly wraps the text (no wasted whitespace)
  const measurer = document.createElement('canvas').getContext('2d')
  measurer.font = FONT
  const textWidth = Math.ceil(measurer.measureText(name).width)

  const canvas = document.createElement('canvas')
  canvas.width = textWidth + PAD * 2
  canvas.height = CANVAS_H
  const ctx = canvas.getContext('2d')
  // No background fill → transparent PNG
  ctx.font = FONT
  ctx.fillStyle = '#1a1a1a'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(name, PAD, BASELINE_Y)

  return {
    raw: canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''),
    baselineFromBottom: (CANVAS_H - BASELINE_Y) / CANVAS_H, // fraction of height below baseline
  }
}

// Normalize a grade string to "PREFIX-NUMBER" format (e.g. "le6" → "LE-6").
function formatGrade(val) {
  if (!val) return val
  const clean = val.trim().toUpperCase().replace(/[-\s]+/g, '')
  const m = clean.match(/^([A-Z]+)(\d+)$/)
  return m ? `${m[1]}-${m[2]}` : clean
}

// Draw a typed cursive name at a form field's widget rectangle.
// Baseline alignment adapts to field height:
//   ≤ 16 pt  → thin line-only widget (Time Off form): line is at field top
//   > 16 pt  → labelled widget (OT form): line is at field bottom
async function drawSignatureText(pdfDoc, form, page, fieldName, signatureName) {
  if (isLegacySignature(signatureName)) return

  const field = form.getFields().find(f => f.getName() === fieldName)
  if (!field) { console.warn(`[pdfExport] field not found: ${fieldName}`); return }

  const widgets = field.acroField.getWidgets()
  if (widgets.length === 0) { console.warn(`[pdfExport] no widgets for: ${fieldName}`); return }
  const rect = widgets[0].getRectangle()

  try {
    const { raw, baselineFromBottom } = await renderNameToCanvas(signatureName)
    const pngBytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0))
    const pngImage = await pdfDoc.embedPng(pngBytes)

    // Scale to fit within field width × 50 pt max height
    const MAX_SIG_HEIGHT = 50
    const scaleByWidth = rect.width / pngImage.width
    const scaleByHeight = MAX_SIG_HEIGHT / pngImage.height
    const scale = Math.min(scaleByWidth, scaleByHeight)
    const drawWidth = pngImage.width * scale
    const drawHeight = pngImage.height * scale

    // Determine where the printed signature line is relative to the widget rect.
    // Thin widgets (h ≤ 16 pt) sit directly on the line → line at rect top.
    // Taller widgets (h > 16 pt) cover the line + label below → line at rect bottom.
    const lineY = rect.height <= 16 ? rect.y + rect.height : rect.y
    const y = lineY - baselineFromBottom * drawHeight

    page.drawImage(pngImage, {
      x: rect.x + (rect.width - drawWidth) / 2,
      y,
      width: drawWidth,
      height: drawHeight,
    })
  } catch (e) {
    console.error(`[pdfExport] drawSignatureText failed for field "${fieldName}":`, e)
  }
}

// Low-level removal of Adobe Sign / signer signature fields before flatten().
// form.removeField() crashes on these because they have no appearance stream and
// pdf-lib's removal path tries to read getNormalAppearance().
// Instead: strip their widget annotation refs from each page's Annots array, then
// remove the field refs from the AcroForm's top-level Fields array.
function removeSignatureFieldsLowLevel(pdfDoc, form) {
  const acroForm = pdfDoc.catalog.getOrCreateAcroForm()

  for (const field of form.getFields()) {
    const name = field.getName()
    if (!name.includes('_es_:signer') && !name.toLowerCase().includes('signature')) continue

    console.log('[removeSignatureFieldsLowLevel] removing field:', name)

    for (const widget of field.acroField.getWidgets()) {
      for (let i = 0; i < pdfDoc.getPageCount(); i++) {
        const pageNode = pdfDoc.getPage(i).node
        const annotsEntry = pageNode.get(PDFName.of('Annots'))
        if (!annotsEntry) continue
        const annotsArr = pdfDoc.context.lookup(annotsEntry)
        if (!annotsArr || !Array.isArray(annotsArr.array)) continue
        const before = annotsArr.array.length
        annotsArr.array = annotsArr.array.filter(
          item => pdfDoc.context.lookup(item) !== widget.dict
        )
        if (annotsArr.array.length !== before) {
          console.log(`[removeSignatureFieldsLowLevel]   removed widget from page ${i} Annots`)
        }
      }
    }

    const fieldsEntry = acroForm.dict.get(PDFName.of('Fields'))
    if (fieldsEntry && Array.isArray(fieldsEntry.array)) {
      const before = fieldsEntry.array.length
      fieldsEntry.array = fieldsEntry.array.filter(
        item => pdfDoc.context.lookup(item) !== field.acroField.dict
      )
      if (fieldsEntry.array.length !== before) {
        console.log(`[removeSignatureFieldsLowLevel]   removed field from AcroForm Fields array`)
      }
    }
  }
}

/* ─── Core fill functions — return a filled PDFDocument, ready to flatten ─── */

export async function fillTimeOffDoc(request, submitterUser, supervisorUser) {
  console.log('[fillTimeOffDoc] start', { request, submitterUser, supervisorUser })

  const templateBytes = await fetch('/pdf/TIME_OFF_REQUEST.pdf').then(r => r.arrayBuffer())
  const pdfDoc = await PDFDocument.load(templateBytes)
  const form = pdfDoc.getForm()
  const page = pdfDoc.getPage(0)

  form.getTextField('NAME').setText(submitterUser?.name || '')
  form.getTextField('DATE OF REQUEST').setText(request.request_date || '')
  form.getTextField('NUMBER OF HOURS').setText(String(request.hours || ''))

  const typeMap = {
    vacation: 'VACATION 1',
    comp: 'COMP TIME',
    sick: 'VACATION 2',
    personal: 'PERSONAL TIME',
    other: 'VACATION 3',
  }
  const typeField = typeMap[(request.type || '').toLowerCase()]
  if (typeField) form.getTextField(typeField).setText('X')

  let datesStr = formatDatesPicked(request.dates_picked)
  if (request.dates_notes) datesStr += datesStr ? ` (${request.dates_notes})` : request.dates_notes
  form.getTextField('DATES').setText(datesStr)

  await drawSignatureText(pdfDoc, form, page, 'Signature1_es_:signer:signature', supervisorUser?.signature_png)
  await drawSignatureText(pdfDoc, form, page, 'Signature2_es_:signer:signature', submitterUser?.signature_png)

  removeSignatureFieldsLowLevel(pdfDoc, form)
  return pdfDoc
}

export async function fillOvertimeDoc(request, submitterUser, staffOfficerUser, deptHeadUser) {
  console.log('[fillOvertimeDoc] start', { request, submitterUser, staffOfficerUser, deptHeadUser })

  const templateBytes = await fetch('/pdf/STATEMENT_OF_OVERTIME.pdf').then(r => r.arrayBuffer())
  const pdfDoc = await PDFDocument.load(templateBytes)
  const form = pdfDoc.getForm()
  const page = pdfDoc.getPage(0)

  form.getTextField('DATE WORKED').setText(request.date_worked || '')
  form.getTextField('TIME WORKED').setText(request.time_worked || '')
  form.getTextField('REG SHIFT TIME').setText(request.reg_shift_time || '')
  form.getTextField('NUMBER OF HOURS WORKED').setText(String(request.hours_worked || ''))
  form.getTextField('CASE NUMBERS').setText(request.case_numbers || '')
  form.getTextField('PURPOSE OF OVERTIME').setText(request.purpose || '')
  form.getTextField('GRADE').setText(formatGrade(request.grade) || '')

  const payComp = (request.payment_or_comp || '').toLowerCase()
  if (payComp === 'payment') form.getTextField('REQUEST PAYMENT').setText('X')
  if (payComp === 'comp') form.getTextField('REQUEST COMP TIME').setText('X')

  await drawSignatureText(pdfDoc, form, page, 'Signature1_es_:signer:signature', submitterUser?.signature_png)
  await drawSignatureText(pdfDoc, form, page, 'STAFF OFFICER APPROVING REQUEST', staffOfficerUser?.signature_png)
  await drawSignatureText(pdfDoc, form, page, 'DEPARTMENT HEAD OR AUTHORIZED', deptHeadUser?.signature_png)

  removeSignatureFieldsLowLevel(pdfDoc, form)
  return pdfDoc
}

/* ─── Single-request export ─── */

export async function exportTimeOffPdf(request, submitterUser, supervisorUser) {
  const pdfDoc = await fillTimeOffDoc(request, submitterUser, supervisorUser)
  pdfDoc.getForm().flatten()
  const date = request.request_date || 'undated'
  downloadPdf(await pdfDoc.save(), `TimeOff_${lastName(submitterUser?.name)}_${date}.pdf`)
}

export async function exportOvertimePdf(request, submitterUser, staffOfficerUser, deptHeadUser) {
  const pdfDoc = await fillOvertimeDoc(request, submitterUser, staffOfficerUser, deptHeadUser)
  pdfDoc.getForm().flatten()
  const date = request.date_worked || 'undated'
  downloadPdf(await pdfDoc.save(), `Overtime_${lastName(submitterUser?.name)}_${date}.pdf`)
}

/* ─── Bulk merge export ─── */

export async function mergeRequestsPdf(rows, fetchUsersForRow, onProgress) {
  const mergedDoc = await PDFDocument.create()
  const skipped = []
  const total = rows.length

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const label = row._type === 'timeoff'
      ? `Time Off – ${row.submitter?.name || row.user_id} (${row.request_date || '?'})`
      : `Overtime – ${row.submitter?.name || row.user_id} (${row.date_worked || '?'})`

    try {
      const users = await fetchUsersForRow(row)
      let filledDoc

      if (row._type === 'timeoff') {
        filledDoc = await fillTimeOffDoc(row, users.submitter, users.supervisor)
      } else {
        filledDoc = await fillOvertimeDoc(row, users.submitter, users.staffOfficer, users.deptHead)
      }

      filledDoc.getForm().flatten()

      const pageIndices = filledDoc.getPageIndices()
      const copiedPages = await mergedDoc.copyPages(filledDoc, pageIndices)
      for (const page of copiedPages) mergedDoc.addPage(page)
    } catch (e) {
      console.error(`[pdfExport] merge: skipped "${label}":`, e)
      skipped.push({ label, reason: e.message || 'Unknown error' })
    }

    onProgress(i + 1, total)
  }

  if (mergedDoc.getPageCount() === 0) {
    throw new Error('No pages were successfully generated — nothing to download.')
  }

  const today = new Date().toISOString().split('T')[0]
  const filename = `Requests_Merged_${today}_${rows.length}items.pdf`
  downloadPdf(await mergedDoc.save(), filename)

  return { skipped }
}
