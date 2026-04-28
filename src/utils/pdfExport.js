import { PDFDocument, PDFName } from 'pdf-lib'

/* ─── Helpers ─── */

// Strip data-URL prefix if present, return raw base64
function toRawBase64(str) {
  if (!str) return null
  return str.replace(/^data:image\/png;base64,/, '')
}

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

// Remove the white fill that the signature canvas applies before drawing.
// Returns a raw base64 PNG with white/near-white pixels made transparent.
function stripWhiteBackground(rawBase64) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const data = imageData.data
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) {
          data[i + 3] = 0
        }
      }
      ctx.putImageData(imageData, 0, 0)
      resolve(canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''))
    }
    img.onerror = reject
    img.src = `data:image/png;base64,${rawBase64}`
  })
}

// Draw a signature PNG at a form field's widget rectangle.
// Does NOT call removeField — that throws on Adobe Sign fields (no appearance stream).
// The field is removed by removeSignatureFieldsLowLevel before flatten.
async function drawSignatureAtField(pdfDoc, form, page, fieldName, signatureBase64) {
  const raw = toRawBase64(signatureBase64)
  if (!raw) return

  const field = form.getFields().find(f => f.getName() === fieldName)
  if (!field) { console.warn(`[pdfExport] field not found: ${fieldName}`); return }

  const widgets = field.acroField.getWidgets()
  if (widgets.length === 0) { console.warn(`[pdfExport] no widgets for: ${fieldName}`); return }
  const rect = widgets[0].getRectangle()

  try {
    const transparent = await stripWhiteBackground(raw)
    const pngBytes = Uint8Array.from(atob(transparent), c => c.charCodeAt(0))
    const pngImage = await pdfDoc.embedPng(pngBytes)

    // Contain within (field width × 50 pt), preserving aspect ratio.
    // 50 pt is the approximate gap between the DATES line and the signature labels.
    const MAX_SIG_HEIGHT = 50
    const scaleByWidth = rect.width / pngImage.width
    const scaleByHeight = MAX_SIG_HEIGHT / pngImage.height
    const scale = Math.min(scaleByWidth, scaleByHeight)
    const drawWidth = pngImage.width * scale
    const drawHeight = pngImage.height * scale

    page.drawImage(pngImage, {
      x: rect.x + (rect.width - drawWidth) / 2,
      y: rect.y + rect.height,  // image bottom on the signature line (field top edge)
      width: drawWidth,
      height: drawHeight,
    })
  } catch (e) {
    console.error(`[pdfExport] draw failed for field "${fieldName}":`, e)
  }
}

// Low-level removal of Adobe Sign / signer signature fields before flatten().
// form.removeField() crashes on these because they have no appearance stream and
// pdf-lib's removal path tries to read getNormalAppearance().
// Instead: strip their widget annotation refs from each page's Annots array, then
// remove the field refs from the AcroForm's top-level Fields array.
// The drawn signature images are already baked into the page content stream by drawImage()
// and are unaffected.
function removeSignatureFieldsLowLevel(pdfDoc, form) {
  const acroForm = pdfDoc.catalog.getOrCreateAcroForm()

  for (const field of form.getFields()) {
    const name = field.getName()
    if (!name.includes('_es_:signer') && !name.toLowerCase().includes('signature')) continue

    console.log('[removeSignatureFieldsLowLevel] removing field:', name)

    // 1. Remove each widget annotation ref from its page's Annots array
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

    // 2. Remove field ref from AcroForm top-level Fields array
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
  console.log('[fillTimeOffDoc] templateBytes byteLength:', templateBytes.byteLength)

  const pdfDoc = await PDFDocument.load(templateBytes)
  console.log('[fillTimeOffDoc] pdfDoc:', pdfDoc)

  const form = pdfDoc.getForm()
  console.log('[fillTimeOffDoc] form:', form)

  const page = pdfDoc.getPage(0)
  console.log('[fillTimeOffDoc] page:', page)

  form.getTextField('NAME').setText(submitterUser?.name || '')
  form.getTextField('DATE OF REQUEST').setText(request.request_date || '')
  form.getTextField('NUMBER OF HOURS').setText(String(request.hours || ''))

  console.log('[fillTimeOffDoc] request.type raw value:', JSON.stringify(request.type))
  console.log('[fillTimeOffDoc] all form fields:', form.getFields().map(f => ({ name: f.getName(), type: f.constructor.name })))

  const typeMap = {
    vacation: 'VACATION 1',
    comp: 'COMP TIME',
    sick: 'VACATION 2',
    personal: 'PERSONAL TIME',
    other: 'VACATION 3',
  }
  const typeField = typeMap[(request.type || '').toLowerCase()]
  console.log('[fillTimeOffDoc] typeField resolved to:', typeField)
  if (typeField) form.getTextField(typeField).setText('X')

  let datesStr = formatDatesPicked(request.dates_picked)
  if (request.dates_notes) datesStr += datesStr ? ` (${request.dates_notes})` : request.dates_notes
  form.getTextField('DATES').setText(datesStr)

  console.log('[fillTimeOffDoc] about to draw sig1 (supervisor):', supervisorUser?.signature_png?.slice(0, 40))
  await drawSignatureAtField(pdfDoc, form, page, 'Signature1_es_:signer:signature', supervisorUser?.signature_png)
  console.log('[fillTimeOffDoc] sig1 done')

  console.log('[fillTimeOffDoc] about to draw sig2 (submitter):', submitterUser?.signature_png?.slice(0, 40))
  await drawSignatureAtField(pdfDoc, form, page, 'Signature2_es_:signer:signature', submitterUser?.signature_png)
  console.log('[fillTimeOffDoc] sig2 done')

  console.log('[fillTimeOffDoc] removing signature fields low-level')
  removeSignatureFieldsLowLevel(pdfDoc, form)
  console.log('[fillTimeOffDoc] done, returning pdfDoc')

  return pdfDoc
}

export async function fillOvertimeDoc(request, submitterUser, staffOfficerUser, deptHeadUser) {
  console.log('[fillOvertimeDoc] start', { request, submitterUser, staffOfficerUser, deptHeadUser })

  const templateBytes = await fetch('/pdf/STATEMENT_OF_OVERTIME.pdf').then(r => r.arrayBuffer())
  console.log('[fillOvertimeDoc] templateBytes byteLength:', templateBytes.byteLength)

  const pdfDoc = await PDFDocument.load(templateBytes)
  console.log('[fillOvertimeDoc] pdfDoc:', pdfDoc)

  const form = pdfDoc.getForm()
  console.log('[fillOvertimeDoc] form:', form)

  const page = pdfDoc.getPage(0)
  console.log('[fillOvertimeDoc] page:', page)

  form.getTextField('DATE WORKED').setText(request.date_worked || '')
  form.getTextField('TIME WORKED').setText(request.time_worked || '')
  form.getTextField('REG SHIFT TIME').setText(request.reg_shift_time || '')
  form.getTextField('NUMBER OF HOURS WORKED').setText(String(request.hours_worked || ''))
  form.getTextField('CASE NUMBERS').setText(request.case_numbers || '')
  form.getTextField('PURPOSE OF OVERTIME').setText(request.purpose || '')
  form.getTextField('GRADE').setText(request.grade || '')

  const payComp = (request.payment_or_comp || '').toLowerCase()
  if (payComp === 'payment') form.getTextField('REQUEST PAYMENT').setText('X')
  if (payComp === 'comp') form.getTextField('REQUEST COMP TIME').setText('X')

  console.log('[fillOvertimeDoc] about to draw sig1 (submitter):', submitterUser?.signature_png?.slice(0, 40))
  await drawSignatureAtField(pdfDoc, form, page, 'Signature1_es_:signer:signature', submitterUser?.signature_png)
  console.log('[fillOvertimeDoc] sig1 done')

  console.log('[fillOvertimeDoc] about to draw staff officer sig:', staffOfficerUser?.signature_png?.slice(0, 40))
  await drawSignatureAtField(pdfDoc, form, page, 'STAFF OFFICER APPROVING REQUEST', staffOfficerUser?.signature_png)
  console.log('[fillOvertimeDoc] staff officer sig done')

  console.log('[fillOvertimeDoc] about to draw dept head sig:', deptHeadUser?.signature_png?.slice(0, 40))
  await drawSignatureAtField(pdfDoc, form, page, 'DEPARTMENT HEAD OR AUTHORIZED', deptHeadUser?.signature_png)
  console.log('[fillOvertimeDoc] dept head sig done')

  console.log('[fillOvertimeDoc] removing signature fields low-level')
  removeSignatureFieldsLowLevel(pdfDoc, form)
  console.log('[fillOvertimeDoc] done, returning pdfDoc')

  return pdfDoc
}

/* ─── Single-request export (existing public API — unchanged behavior) ─── */

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

// fetchUsersForRow: async (row) => { submitter, supervisor?, staffOfficer?, deptHead? }
// onProgress: (done, total) => void — called after each request is processed
// Returns { skipped: [{ label, reason }] } for caller to surface errors.
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
