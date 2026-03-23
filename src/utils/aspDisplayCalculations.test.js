import assert from 'node:assert/strict'

import { buildDisplayRows } from './aspDisplayCalculations.js'

const testOwnElasticityResponse = () => {
  const rows = [
    {
      productName: 'Brand 499 | cotton',
      baseAsp: 499,
      currentAsp: 499,
      optimizedAsp: 499,
      currentVolume: 100,
    },
  ]
  const modelContext = {
    ownElasticities: [-1],
    betaPpu: [-100 / 499],
    gammaMatrix: [[0]],
    basePrices: [499],
    baseVolumes: [100],
  }

  const noChange = buildDisplayRows({
    rows,
    selectedMonth: '2024-W31',
    modelContext,
  })
  const increased = buildDisplayRows({
    rows,
    selectedMonth: '2024-W31',
    recommendedPriceEditMap: { 'Brand 499 | cotton': 549 },
    modelContext,
  })

  assert.equal(noChange[0].currentVolume, 100)
  assert.equal(increased[0].currentVolume, 100)
  assert.ok(increased[0].optimizedVolume < noChange[0].optimizedVolume)
  assert.ok(increased[0].ownVolumeDelta < 0)
}

const testCrossElasticityResponse = () => {
  const rows = [
    {
      productName: 'Brand 799 | cotton',
      baseAsp: 799,
      currentAsp: 799,
      optimizedAsp: 799,
      currentVolume: 1000,
    },
    {
      productName: 'Brand 899 | cotton',
      baseAsp: 899,
      currentAsp: 899,
      optimizedAsp: 899,
      currentVolume: 1000,
    },
  ]
  const modelContext = {
    ownElasticities: [-1.2, -1.1],
    betaPpu: [(-1.2 * 1000) / 799, (-1.1 * 1000) / 899],
    gammaMatrix: [
      [0, 0],
      [0, 0],
    ],
    basePrices: [799, 899],
    baseVolumes: [1000, 1000],
  }

  const noChange = buildDisplayRows({
    rows,
    selectedMonth: '2024-W31',
    modelContext,
  })
  const edited = buildDisplayRows({
    rows,
    selectedMonth: '2024-W31',
    recommendedPriceEditMap: { 'Brand 799 | cotton': 899 },
    modelContext,
  })

  const unchangedProductNoChange = noChange[1]
  const unchangedProductEdited = edited[1]

  assert.equal(unchangedProductEdited.currentAsp, 899)
  assert.equal(unchangedProductEdited.optimizedAsp, 899)
  assert.ok(Math.abs(unchangedProductEdited.ownVolumeDelta) < 1e-9)
  assert.ok(unchangedProductEdited.crossVolumeDelta > 0)
  assert.ok(unchangedProductEdited.optimizedVolume > unchangedProductNoChange.optimizedVolume)
}

testOwnElasticityResponse()
testCrossElasticityResponse()
console.log('aspDisplayCalculations.test.js passed')
