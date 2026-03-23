export const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

export const buildPriceBounds = (rows, maxChangePct) => {
  const maxChangeFactor = maxChangePct / 100

  return rows.map((row) => ({
    min: row.currentPrice * (1 - maxChangeFactor),
    max: row.currentPrice * (1 + maxChangeFactor),
  }))
}

export const enforceLadderConstraints = ({
  prices,
  bounds,
  minGap,
}) => {
  const adjusted = prices.map((price, index) => clamp(price, bounds[index].min, bounds[index].max))

  // Alternating forward/backward passes to satisfy bounds + min-gap ladder constraints.
  for (let pass = 0; pass < 5; pass += 1) {
    for (let i = 1; i < adjusted.length; i += 1) {
      const minAllowed = adjusted[i - 1] + minGap
      adjusted[i] = Math.max(adjusted[i], minAllowed)
      adjusted[i] = Math.min(adjusted[i], bounds[i].max)
    }

    for (let i = adjusted.length - 2; i >= 0; i -= 1) {
      const maxAllowed = adjusted[i + 1] - minGap
      adjusted[i] = Math.min(adjusted[i], maxAllowed)
      adjusted[i] = Math.max(adjusted[i], bounds[i].min)
    }
  }

  return adjusted.map((price, index) => clamp(price, bounds[index].min, bounds[index].max))
}

export const isLadderValid = ({ prices, bounds, minGap }) => {
  for (let i = 0; i < prices.length; i += 1) {
    const price = prices[i]
    if (price < bounds[i].min - 1e-6 || price > bounds[i].max + 1e-6) {
      return false
    }

    if (i > 0 && price - prices[i - 1] < minGap - 1e-6) {
      return false
    }
  }

  return true
}
