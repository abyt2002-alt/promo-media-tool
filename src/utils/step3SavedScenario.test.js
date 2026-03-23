import assert from 'node:assert/strict'

import { buildStep3SavedScenarioSnapshot } from './step3SavedScenario.js'

const testSavedSnapshotFields = () => {
  const source = {
    selectedMonth: '2024-W31',
    selectedScenarioId: '5',
    baseTotals: { totalVolume: 1000, totalRevenue: 500000, totalProfit: 250000 },
    optimizedTotals: { totalVolume: 1040, totalRevenue: 522000, totalProfit: 262000 },
    optimizedProducts: [
      {
        productName: 'Brand 799 | cotton',
        baseAsp: 799,
        optimizedAsp: 849,
        currentVolume: 1000,
        optimizedVolume: 980,
        currentRevenue: 799000,
        optimizedRevenue: 832020,
        currentProfit: 479400,
        optimizedProfit: 499212,
        ownElasticity: -1.62,
        ownVolumeDelta: -24.3,
        crossVolumeDelta: 4.1,
        baselineDriftPct: 0.02,
        volumeChangePct: -0.02,
        revenueChangePct: 0.041,
        profitChangePct: 0.041,
      },
    ],
  }

  const snapshot = buildStep3SavedScenarioSnapshot({
    source,
    scenarioName: 'PremiumImpact 5',
  })

  assert.ok(snapshot.id.startsWith('step3_'))
  assert.ok(snapshot.name.includes('PremiumImpact 5'))
  assert.equal(snapshot.selectedMonth, '2024-W31')
  assert.equal(snapshot.rows.length, 1)
  assert.equal(snapshot.rows[0].ownElasticity, -1.62)
  assert.equal(snapshot.rows[0].ownVolumeDelta, -24.3)
  assert.equal(snapshot.rows[0].crossVolumeDelta, 4.1)
  assert.equal(snapshot.rows[0].baselineDriftPct, 0.02)
}

testSavedSnapshotFields()
console.log('step3SavedScenario.test.js passed')
