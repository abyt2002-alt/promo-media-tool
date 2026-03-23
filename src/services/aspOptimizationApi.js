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
    // ignore and fallback
  }
  return `Optimization request failed (${response.status})`
}

export const optimizeAspLadder = async (requestPayload) => {
  const response = await fetch('/api/asp-determination/optimize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestPayload),
  })

  if (!response.ok) {
    throw new Error(await parseApiError(response))
  }

  return response.json()
}

export const createAspOptimizationJob = async (requestPayload) => {
  const response = await fetch('/api/asp-determination/optimize-jobs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestPayload),
  })

  if (!response.ok) {
    throw new Error(await parseApiError(response))
  }

  return response.json()
}

export const getAspOptimizationJobStatus = async (jobId) => {
  const response = await fetch(`/api/asp-determination/optimize-jobs/${encodeURIComponent(jobId)}/status`)
  if (!response.ok) {
    throw new Error(await parseApiError(response))
  }
  return response.json()
}

export const getAspOptimizationJobResult = async (jobId) => {
  const response = await fetch(`/api/asp-determination/optimize-jobs/${encodeURIComponent(jobId)}/result`)
  if (!response.ok) {
    throw new Error(await parseApiError(response))
  }
  return response.json()
}

export const runAspOptimizationJob = async (requestPayload, { onProgress, pollMs = 1000, timeoutMs = 180000 } = {}) => {
  const runJobPolling = async () => {
    const created = await createAspOptimizationJob(requestPayload)
    const jobId = created?.job_id
    if (!jobId) {
      throw new Error('Failed to create optimization job.')
    }

    const startedAt = Date.now()
    let lastKnownStage = 'Queued'
    let transientStatusErrors = 0

    while (Date.now() - startedAt <= timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, pollMs))

      let status
      try {
        status = await getAspOptimizationJobStatus(jobId)
        transientStatusErrors = 0
      } catch (statusError) {
        transientStatusErrors += 1
        if (transientStatusErrors >= 4) {
          throw statusError
        }
        if (onProgress) {
          onProgress({
            status: 'running',
            progress_pct: 0,
            stage: 'Reconnecting to optimization job...',
          })
        }
        continue
      }

      lastKnownStage = status?.stage || lastKnownStage
      if (onProgress) {
        onProgress(status)
      }

      if (status?.status === 'completed') {
        const resultPayload = await getAspOptimizationJobResult(jobId)
        if (!resultPayload?.result) {
          throw new Error('Optimization completed but result payload is empty.')
        }
        return resultPayload.result
      }

      if (status?.status === 'failed') {
        throw new Error(normalizeErrorMessage(status?.error) || 'Optimization job failed.')
      }
    }

    throw new Error(`Optimization job timed out at stage: ${lastKnownStage}.`)
  }

  try {
    return await runJobPolling()
  } catch (jobError) {
    if (onProgress) {
      onProgress({
        status: 'running',
        progress_pct: 95,
        stage: 'Retrying in direct mode...',
      })
    }
    try {
      return await optimizeAspLadder(requestPayload)
    } catch (fallbackError) {
      const primaryMessage = jobError?.message || 'Optimization job failed.'
      const fallbackMessage = fallbackError?.message || 'Direct optimization failed.'
      throw new Error(`${primaryMessage} ${fallbackMessage}`)
    }
  }
}
