import { PDFDocument } from 'pdf-lib'

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

// Draw a signature PNG at a form field's widget rectangle, then remove the field.
// Works for any field type (text, Adobe Sign signature, etc.).
// Does NOT call removeField — Adobe Sign fields throw in removeField because they
// have no appearance stream. The orphan field is invisible after flatten({ updateFieldAppearances: false }).
async function drawSignatureAtField(pdfDoc, form, page, fieldName, signatureBase64) {
  const raw = toRawBase64(signatureBase64)
  if (!raw) return

  const field = form.getFields().find(f => f.getName() === fieldName)
  if (!field) { console.warn(`[pdfExport] field not found: ${fieldName}`); return }

  const widgets = field.acroField.getWidgets()
  if (widgets.length === 0) { console.warn(`[pdfExport] no widgets for: ${fieldName}`); return }
  const rect = widgets[0].getRectangle()

  try {
    const pngBytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0))
    const pngImage = await pdfDoc.embedPng(pngBytes)

    const scale = Math.min(rect.width / pngImage.width, rect.height / pngImage.height)
    const drawWidth = pngImage.width * scale
    const drawHeight = pngImage.height * scale

    page.drawImage(pngImage, {
      x: rect.x + (rect.width - drawWidth) / 2,
      y: rect.y + (rect.height - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight,
    })
  } catch (e) {
    console.error(`[pdfExport] draw failed for field "${fieldName}":`, e)
  }
}

/* ─── Core fill functions — return a filled PDFDocument (not yet flattened) ─── */

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

  console.log('[fillTimeOffDoc] about to draw sig1 (supervisor):', supervisorUser?.signature_png?.slice(0, 40))
  await drawSignatureAtField(pdfDoc, form, page, 'Signature1_es_:signer:signature', supervisorUser?.signature_png)
  console.log('[fillTimeOffDoc] sig1 done')

  console.log('[fillTimeOffDoc] about to draw sig2 (submitter):', submitterUser?.signature_png?.slice(0, 40))
  await drawSignatureAtField(pdfDoc, form, page, 'Signature2_es_:signer:signature', submitterUser?.signature_png)
  console.log('[fillTimeOffDoc] sig2 done, returning pdfDoc')

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
  console.log('[fillOvertimeDoc] dept head sig done, returning pdfDoc')

  return pdfDoc
}

/* ─── Single-request export (existing public API — unchanged behavior) ─── */

export async function exportTimeOffPdf(request, submitterUser, supervisorUser) {
  const pdfDoc = await fillTimeOffDoc(request, submitterUser, supervisorUser)
  pdfDoc.getForm().flatten({ updateFieldAppearances: false })
  const date = request.request_date || 'undated'
  downloadPdf(await pdfDoc.save(), `TimeOff_${lastName(submitterUser?.name)}_${date}.pdf`)
}

export async function exportOvertimePdf(request, submitterUser, staffOfficerUser, deptHeadUser) {
  const pdfDoc = await fillOvertimeDoc(request, submitterUser, staffOfficerUser, deptHeadUser)
  pdfDoc.getForm().flatten({ updateFieldAppearances: false })
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

      // Flatten this doc so form values bake into page content before copyPages
      filledDoc.getForm().flatten({ updateFieldAppearances: false })

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
