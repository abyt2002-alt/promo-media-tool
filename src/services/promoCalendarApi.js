const normalizeErrorMessage = (value) => {
  if (value == null) return null
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const joined = value
      .map((item) => normalizeErrorMessage(item))
      .filter(Boolean)
      .join(' | ')
    return joined || null
  }
  if (typeof value === 'object') {
    const detail = value?.msg ?? value?.message ?? value?.detail
    if (detail) return normalizeErrorMessage(detail)
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

const parseApiError = async (response) => {
  try {
    const payload = await response.json()
    const message = normalizeErrorMessage(payload?.detail ?? payload?.error ?? payload?.message ?? payload)
    if (message) return message
  } catch {
    // ignore parse error
  }
  return `Promo calendar request failed (${response.status})`
}

export const optimizePromoCalendar = async (requestPayload) => {
  const response = await fetch('/api/promo-calendar/optimize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestPayload),
  })
  if (!response.ok) {
    throw new Error(await parseApiError(response))
  }
  return response.json()
}

export const getHistoricalPromoCalendar = async ({ year, channel } = {}) => {
  const params = new URLSearchParams()
  if (year != null && String(year).trim() !== '') params.set('year', String(year))
  if (channel != null && String(channel).trim() !== '') params.set('channel', String(channel))
  const query = params.toString()
  const response = await fetch(`/api/promo-calendar/historical${query ? `?${query}` : ''}`)
  if (!response.ok) {
    throw new Error(await parseApiError(response))
  }
  return response.json()
}

export const getPromoElasticityInsights = async ({ year, channel } = {}) => {
  const params = new URLSearchParams()
  if (year != null && String(year).trim() !== '') params.set('year', String(year))
  if (channel != null && String(channel).trim() !== '') params.set('channel', String(channel))
  const query = params.toString()
  const response = await fetch(`/api/promo-calendar/insights${query ? `?${query}` : ''}`)
  if (!response.ok) {
    throw new Error(await parseApiError(response))
  }
  return response.json()
}

export const createPromoCalendarJob = async (requestPayload) => {
  const response = await fetch('/api/promo-calendar/optimize-jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestPayload),
  })
  if (!response.ok) {
    throw new Error(await parseApiError(response))
  }
  return response.json()
}

export const getPromoCalendarJobStatus = async (jobId) => {
  const response = await fetch(`/api/promo-calendar/optimize-jobs/${encodeURIComponent(jobId)}/status`)
  if (!response.ok) {
    throw new Error(await parseApiError(response))
  }
  return response.json()
}

export const getPromoCalendarJobResult = async (jobId) => {
  const response = await fetch(`/api/promo-calendar/optimize-jobs/${encodeURIComponent(jobId)}/result`)
  if (!response.ok) {
    throw new Error(await parseApiError(response))
  }
  return response.json()
}

export const recalculatePromoCalendar = async (requestPayload) => {
  const response = await fetch('/api/promo-calendar/recalculate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestPayload),
  })
  if (!response.ok) {
    throw new Error(await parseApiError(response))
  }
  return response.json()
}

export const runPromoCalendarJob = async (requestPayload, { onProgress, pollMs = 1000, timeoutMs = 180000 } = {}) => {
  const created = await createPromoCalendarJob(requestPayload)
  const jobId = created?.job_id
  if (!jobId) {
    throw new Error('Failed to create promo optimization job.')
  }

  const startedAt = Date.now()
  while (Date.now() - startedAt <= timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, pollMs))
    const status = await getPromoCalendarJobStatus(jobId)
    if (onProgress) onProgress(status)
    if (status?.status === 'completed') {
      const resultPayload = await getPromoCalendarJobResult(jobId)
      if (!resultPayload?.result) {
        throw new Error('Promo optimization completed without result payload.')
      }
      return resultPayload.result
    }
    if (status?.status === 'failed') {
      throw new Error(normalizeErrorMessage(status?.error) || 'Promo optimization failed.')
    }
  }

  if (onProgress) {
    onProgress({
      status: 'running',
      progress_pct: 95,
      stage: 'Falling back to direct mode...',
    })
  }
  return optimizePromoCalendar(requestPayload)
}
