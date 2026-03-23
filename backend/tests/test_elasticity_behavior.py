import unittest

from backend.services.asp_optimization_service import _evaluate_prices
from backend.utils.elasticity_utils import (
    build_cross_elasticity_matrix,
    build_own_elasticities,
    convert_to_base_reference,
)


class ElasticityBehaviorTests(unittest.TestCase):
    def test_own_elasticities_are_negative_and_bounded(self):
        rows = [
            {"productName": "Brand 349 | cotton", "basePrice": 349, "currentPrice": 349, "volume": 1000},
            {"productName": "Brand 599 | cotton", "basePrice": 599, "currentPrice": 599, "volume": 900},
            {"productName": "Brand 999 | polyester", "basePrice": 999, "currentPrice": 999, "volume": 400},
        ]
        own = build_own_elasticities(rows)
        self.assertEqual(len(own), 3)
        for value in own:
            self.assertLessEqual(value, -0.5)
            self.assertGreaterEqual(value, -2.5)
        self.assertAlmostEqual(own[1], -1.33, places=2)

    def test_cross_elasticity_window_and_sign(self):
        rows = [
            {"productName": "A", "currentPrice": 500},
            {"productName": "B", "currentPrice": 560},
            {"productName": "C", "currentPrice": 710},
        ]
        matrix = build_cross_elasticity_matrix(rows)
        self.assertEqual(matrix[0][0], 0.0)
        self.assertLess(matrix[0][1], 0.0)  # within 100, active negative cross
        self.assertEqual(matrix[0][2], 0.0)  # outside 100, no cross interaction

    def test_cross_effect_increases_other_product_volume_for_substitute_price_rise(self):
        base_prices = [800.0, 850.0]
        base_volumes = [1000.0, 1000.0]
        beta_ppu = [-1.25, -1.1764705882352942]  # own elastic effect at base
        gamma_matrix = [
            [0.0, -0.5],
            [-0.5, 0.0],
        ]
        unit_costs = [320.0, 340.0]

        # only product-0 price changes
        prices = [850.0, 850.0]
        volumes, _ = _evaluate_prices(
            prices=prices,
            base_prices=base_prices,
            base_volumes=base_volumes,
            beta_ppu=beta_ppu,
            gamma_matrix=gamma_matrix,
            unit_costs=unit_costs,
        )

        # own effect lowers volume for changed product-0
        self.assertLess(volumes[0], base_volumes[0])
        # cross effect raises volume for unchanged product-1 (substitute response)
        self.assertGreater(volumes[1], base_volumes[1])

    def test_base_reference_conversion_keeps_cross_matrix_shape(self):
        rows = [
            {"productName": "Brand 799 | cotton", "basePrice": 799, "currentPrice": 829, "volume": 1200},
            {"productName": "Brand 899 | cotton", "basePrice": 899, "currentPrice": 879, "volume": 950},
            {"productName": "Brand 999 | polyester", "basePrice": 999, "currentPrice": 999, "volume": 700},
        ]
        own_current = build_own_elasticities(rows)
        cross_current = build_cross_elasticity_matrix(rows)
        own_base, cross_base, base_volumes = convert_to_base_reference(rows, own_current, cross_current)

        self.assertEqual(len(own_base), len(rows))
        self.assertEqual(len(base_volumes), len(rows))
        self.assertEqual(len(cross_base), len(rows))
        self.assertTrue(all(len(r) == len(rows) for r in cross_base))
        self.assertTrue(all(v > 0 for v in base_volumes))


if __name__ == "__main__":
    unittest.main()
