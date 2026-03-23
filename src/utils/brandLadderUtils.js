export const getAvailableMonths = (rows) => {
  return [...new Set(rows.map((row) => row.yearMonth))].sort()
}

export const formatYearMonthLabel = (yearMonth) => {
  if (yearMonth?.includes('-W')) {
    const [year, week] = yearMonth.split('-W')
    return `Week ${week}, ${year}`
  }

  const [year, month] = yearMonth.split('-')
  const date = new Date(Number(year), Number(month) - 1, 1)
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(date)
}

export const filterDataByMonth = (rows, yearMonth) => {
  return rows.filter((row) => row.yearMonth === yearMonth)
}

export const sortLadderByCurrentPrice = (rows) => {
  return [...rows].sort((a, b) => a.currentPrice - b.currentPrice || a.productName.localeCompare(b.productName))
}

export const sortLadderByBasePrice = (rows) => {
  return [...rows].sort((a, b) => a.basePrice - b.basePrice || a.productName.localeCompare(b.productName))
}

export const filterCompetitorsByMonthAndBrand = (rows, yearMonth, selectedBrand) => {
  return rows.filter((row) => row.yearMonth === yearMonth && row.brandName === selectedBrand)
}

export const computeMarketShareByVolume = (rows) => {
  const totalVolume = rows.reduce((sum, row) => sum + row.volume, 0)

  return {
    totalVolume,
    shareRows: rows
      .map((row) => ({
        productName: row.productName,
        basePrice: row.basePrice,
        currentPrice: row.currentPrice,
        volume: row.volume,
        sharePct: totalVolume === 0 ? 0 : Number(((row.volume / totalVolume) * 100).toFixed(2)),
      }))
      .sort((a, b) => b.sharePct - a.sharePct),
  }
}

export const prepareOwnCompareViewData = (rows, month1, month2) => {
  const month1Rows = sortLadderByBasePrice(filterDataByMonth(rows, month1))
  const month2Rows = sortLadderByBasePrice(filterDataByMonth(rows, month2))

  return { month1Rows, month2Rows }
}

export const computeCompetitorSummaryRows = (competitorRows) => {
  return sortLadderByCurrentPrice(competitorRows).map((row) => ({
    brandName: row.brandName,
    productName: row.productName,
    currentPrice: row.currentPrice,
    volume: row.volume,
    distribution: row.distribution,
  }))
}

export const computeMonthSummary = (rows) => {
  if (!rows.length) {
    return {
      minPrice: 0,
      maxPrice: 0,
      avgPrice: 0,
      totalVolume: 0,
    }
  }

  const totalVolume = rows.reduce((sum, row) => sum + row.volume, 0)
  const totalPrice = rows.reduce((sum, row) => sum + row.basePrice, 0)

  return {
    minPrice: Math.min(...rows.map((row) => row.basePrice)),
    maxPrice: Math.max(...rows.map((row) => row.basePrice)),
    avgPrice: Math.round(totalPrice / rows.length),
    totalVolume,
  }
}
