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
  // Group by month+year
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

// Embed a signature PNG into a form field (by field name) as an image overlay
async function embedSignatureInField(pdfDoc, form, page, fieldName, signatureBase64) {
  const raw = toRawBase64(signatureBase64)
  if (!raw) return
  const pngBytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0))
  const pngImage = await pdfDoc.embedPng(pngBytes)

  const field = form.getTextField(fieldName)
  const widgets = field.acroField.getWidgets()
  if (widgets.length === 0) return
  const rect = widgets[0].getRectangle()

  // Scale image to fit within the field rectangle while maintaining aspect ratio
  const scale = Math.min(rect.width / pngImage.width, rect.height / pngImage.height)
  const drawWidth = pngImage.width * scale
  const drawHeight = pngImage.height * scale

  page.drawImage(pngImage, {
    x: rect.x + (rect.width - drawWidth) / 2,
    y: rect.y + (rect.height - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
  })

  // Remove the field so placeholder text doesn't render over the image
  form.removeField(field)
}

/* ─── Time Off PDF ─── */

export async function exportTimeOffPdf(request, submitterUser, supervisorUser) {
  const templateBytes = await fetch('/pdf/TIME_OFF_REQUEST.pdf').then(r => r.arrayBuffer())
  const pdfDoc = await PDFDocument.load(templateBytes)
  const form = pdfDoc.getForm()
  const page = pdfDoc.getPage(0)

  // Text fields
  form.getTextField('NAME').setText(submitterUser?.name || '')
  form.getTextField('DATE OF REQUEST').setText(request.request_date || '')
  form.getTextField('NUMBER OF HOURS').setText(String(request.hours || ''))

  // Checkbox-style text fields — set "X" for the matching type
  const typeMap = {
    vacation: 'VACATION 1',
    comp: 'COMP TIME',
    sick: 'VACATION 2',
    personal: 'PERSONAL TIME',
    other: 'VACATION 3',
  }
  const typeField = typeMap[(request.type || '').toLowerCase()]
  if (typeField) {
    form.getTextField(typeField).setText('X')
  }

  // Dates field
  let datesStr = formatDatesPicked(request.dates_picked)
  if (request.dates_notes) {
    datesStr += datesStr ? ` (${request.dates_notes})` : request.dates_notes
  }
  form.getTextField('DATES').setText(datesStr)

  // Signatures — supervisor = Signature1, submitter = Signature2
  if (supervisorUser?.signature_png) {
    await embedSignatureInField(pdfDoc, form, page, 'Signature1_es_:signer:signature', supervisorUser.signature_png)
  }
  if (submitterUser?.signature_png) {
    await embedSignatureInField(pdfDoc, form, page, 'Signature2_es_:signer:signature', submitterUser.signature_png)
  }

  form.flatten()
  const pdfBytes = await pdfDoc.save()

  const date = request.request_date || 'undated'
  downloadPdf(pdfBytes, `TimeOff_${lastName(submitterUser?.name)}_${date}.pdf`)
}

/* ─── Overtime PDF ─── */

export async function exportOvertimePdf(request, submitterUser, staffOfficerUser, deptHeadUser) {
  const templateBytes = await fetch('/pdf/STATEMENT_OF_OVERTIME.pdf').then(r => r.arrayBuffer())
  const pdfDoc = await PDFDocument.load(templateBytes)
  const form = pdfDoc.getForm()
  const page = pdfDoc.getPage(0)

  // Direct text fields
  form.getTextField('DATE WORKED').setText(request.date_worked || '')
  form.getTextField('TIME WORKED').setText(request.time_worked || '')
  form.getTextField('REG SHIFT TIME').setText(request.reg_shift_time || '')
  form.getTextField('NUMBER OF HOURS WORKED').setText(String(request.hours_worked || ''))
  form.getTextField('CASE NUMBERS').setText(request.case_numbers || '')
  form.getTextField('PURPOSE OF OVERTIME').setText(request.purpose || '')
  form.getTextField('GRADE').setText(request.grade || '')

  // Payment / comp checkboxes
  const payComp = (request.payment_or_comp || '').toLowerCase()
  if (payComp === 'payment') form.getTextField('REQUEST PAYMENT').setText('X')
  if (payComp === 'comp') form.getTextField('REQUEST COMP TIME').setText('X')

  // Submitter signature — Signature1 is a text field but we draw an image
  if (submitterUser?.signature_png) {
    await embedSignatureInField(pdfDoc, form, page, 'Signature1_es_:signer:signature', submitterUser.signature_png)
  }

  // Staff Officer — text field, draw image at widget rect
  if (staffOfficerUser?.signature_png) {
    await embedSignatureInField(pdfDoc, form, page, 'STAFF OFFICER APPROVING REQUEST', staffOfficerUser.signature_png)
  }

  // Department Head — text field, draw image at widget rect
  if (deptHeadUser?.signature_png) {
    await embedSignatureInField(pdfDoc, form, page, 'DEPARTMENT HEAD OR AUTHORIZED', deptHeadUser.signature_png)
  }

  form.flatten()
  const pdfBytes = await pdfDoc.save()

  const date = request.date_worked || 'undated'
  downloadPdf(pdfBytes, `Overtime_${lastName(submitterUser?.name)}_${date}.pdf`)
}
