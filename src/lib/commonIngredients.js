// Reference nutrition table for common home-cooking ingredients — raw
// materials (rice, dal, onion, oil…) rather than packaged products, which is
// exactly what a barcode/name lookup against OFF or USDA's *branded* dataset
// tends to miss. Values are typical per-100g figures from standard nutrition
// references, not a measurement of any specific batch — good enough to
// estimate a home-cooked dish, not precise enough to be a lab result. Kept
// as a local table (same "local fallback" pattern as lib/hazards.js) so the
// Dish Builder works instantly and offline for the common case; USDA search
// and manual entry (see DishBuilder.jsx) cover anything not listed here.
//
// Fields are per 100g: kcal, protein/fat/carbs/sugar/fiber in grams, sodium
// in mg. `serving` is an optional human-readable weight hint shown as a tip,
// not used in any calculation.
const COMMON_INGREDIENTS = [
  // ── grains & starches ──
  { name: "Rice, white, raw", kcal: 365, protein: 7.1, fat: 0.7, carbs: 80, sugar: 0.1, fiber: 1.3, sodium: 1, serving: "1 cup raw ≈ 185g" },
  { name: "Rice, white, cooked", kcal: 130, protein: 2.7, fat: 0.3, carbs: 28, sugar: 0.1, fiber: 0.4, sodium: 1, serving: "1 cup cooked ≈ 195g" },
  { name: "Rice, brown, cooked", kcal: 123, protein: 2.7, fat: 1.0, carbs: 26, sugar: 0.4, fiber: 1.6, sodium: 4, serving: "1 cup cooked ≈ 195g" },
  { name: "Wheat flour, whole (atta)", kcal: 340, protein: 13.2, fat: 2.5, carbs: 72, sugar: 0.4, fiber: 11, sodium: 2 },
  { name: "Roti / chapati, plain cooked", kcal: 297, protein: 9.9, fat: 6.9, carbs: 51, sugar: 1.5, fiber: 8, sodium: 4, serving: "1 medium roti ≈ 30-40g" },
  { name: "Bread, white", kcal: 265, protein: 9.0, fat: 3.2, carbs: 49, sugar: 5.0, fiber: 2.7, sodium: 490, serving: "1 slice ≈ 30g" },
  { name: "Oats, raw", kcal: 389, protein: 16.9, fat: 6.9, carbs: 66, sugar: 1.0, fiber: 10.6, sodium: 2 },
  { name: "Potato, raw", kcal: 77, protein: 2.0, fat: 0.1, carbs: 17, sugar: 0.8, fiber: 2.2, sodium: 6 },
  { name: "Potato, boiled", kcal: 87, protein: 1.9, fat: 0.1, carbs: 20, sugar: 0.9, fiber: 1.8, sodium: 4 },

  // ── legumes (cooked, no oil added) ──
  { name: "Toor / pigeon pea dal, cooked", kcal: 121, protein: 7.3, fat: 0.4, carbs: 21, sugar: 2.0, fiber: 5.0, sodium: 4, serving: "1 cup cooked ≈ 200g" },
  { name: "Moong dal, cooked", kcal: 105, protein: 7.0, fat: 0.4, carbs: 19, sugar: 2.0, fiber: 7.6, sodium: 4 },
  { name: "Chana / chickpeas, cooked", kcal: 164, protein: 8.9, fat: 2.6, carbs: 27, sugar: 4.8, fiber: 7.6, sodium: 7, serving: "1 cup cooked ≈ 165g" },
  { name: "Rajma / kidney beans, cooked", kcal: 127, protein: 8.7, fat: 0.5, carbs: 22.8, sugar: 0.3, fiber: 6.4, sodium: 2 },
  { name: "Lentils, cooked (general)", kcal: 116, protein: 9.0, fat: 0.4, carbs: 20, sugar: 1.8, fiber: 7.9, sodium: 2 },
  { name: "Tofu, firm", kcal: 144, protein: 15.5, fat: 8.7, carbs: 2.8, sugar: 0.6, fiber: 2.3, sodium: 12 },

  // ── vegetables ──
  { name: "Onion, raw", kcal: 40, protein: 1.1, fat: 0.1, carbs: 9.3, sugar: 4.2, fiber: 1.7, sodium: 4 },
  { name: "Tomato, raw", kcal: 18, protein: 0.9, fat: 0.2, carbs: 3.9, sugar: 2.6, fiber: 1.2, sodium: 5 },
  { name: "Carrot, raw", kcal: 41, protein: 0.9, fat: 0.2, carbs: 9.6, sugar: 4.7, fiber: 2.8, sodium: 69 },
  { name: "Cauliflower, raw", kcal: 25, protein: 1.9, fat: 0.3, carbs: 5.0, sugar: 1.9, fiber: 2.0, sodium: 30 },
  { name: "Spinach, raw", kcal: 23, protein: 2.9, fat: 0.4, carbs: 3.6, sugar: 0.4, fiber: 2.2, sodium: 79 },
  { name: "Green peas, boiled", kcal: 81, protein: 5.4, fat: 0.4, carbs: 14, sugar: 5.7, fiber: 5.1, sodium: 3 },
  { name: "Bell pepper / capsicum, raw", kcal: 26, protein: 1.0, fat: 0.3, carbs: 6.0, sugar: 4.2, fiber: 2.1, sodium: 3 },
  { name: "Cucumber, raw", kcal: 15, protein: 0.7, fat: 0.1, carbs: 3.6, sugar: 1.7, fiber: 0.5, sodium: 2 },
  { name: "Garlic, raw", kcal: 149, protein: 6.4, fat: 0.5, carbs: 33, sugar: 1.0, fiber: 2.1, sodium: 17, serving: "used in small amounts, ~3g/clove" },
  { name: "Ginger, raw", kcal: 80, protein: 1.8, fat: 0.8, carbs: 18, sugar: 1.7, fiber: 2.0, sodium: 13 },

  // ── oils & fats ──
  { name: "Cooking oil (vegetable/sunflower)", kcal: 884, protein: 0, fat: 100, carbs: 0, sugar: 0, fiber: 0, sodium: 0, serving: "1 tbsp ≈ 14g" },
  { name: "Olive oil", kcal: 884, protein: 0, fat: 100, carbs: 0, sugar: 0, fiber: 0, sodium: 2 },
  { name: "Ghee (clarified butter)", kcal: 900, protein: 0, fat: 100, carbs: 0, sugar: 0, fiber: 0, sodium: 0, serving: "1 tbsp ≈ 13g" },
  { name: "Butter", kcal: 717, protein: 0.9, fat: 81, carbs: 0.1, sugar: 0.1, fiber: 0, sodium: 11 },
  { name: "Coconut milk, canned", kcal: 230, protein: 2.3, fat: 24, carbs: 5.5, sugar: 3.3, fiber: 2.2, sodium: 15 },
  { name: "Coconut, grated fresh", kcal: 354, protein: 3.3, fat: 33, carbs: 15, sugar: 6.2, fiber: 9.0, sodium: 20 },

  // ── dairy ──
  { name: "Milk, whole", kcal: 61, protein: 3.2, fat: 3.3, carbs: 4.8, sugar: 5.1, fiber: 0, sodium: 43 },
  { name: "Curd / yogurt, plain whole-milk", kcal: 61, protein: 3.5, fat: 3.3, carbs: 4.7, sugar: 4.7, fiber: 0, sodium: 36 },
  { name: "Paneer (Indian cottage cheese)", kcal: 265, protein: 18.3, fat: 20.8, carbs: 1.2, sugar: 1.2, fiber: 0, sodium: 18 },
  { name: "Cheese, cheddar", kcal: 403, protein: 25, fat: 33, carbs: 1.3, sugar: 0.5, fiber: 0, sodium: 621 },

  // ── protein ──
  { name: "Chicken breast, cooked, skinless", kcal: 165, protein: 31, fat: 3.6, carbs: 0, sugar: 0, fiber: 0, sodium: 74 },
  { name: "Chicken thigh, cooked, skinless", kcal: 209, protein: 26, fat: 10.9, carbs: 0, sugar: 0, fiber: 0, sodium: 90 },
  { name: "Egg, whole", kcal: 143, protein: 12.6, fat: 9.5, carbs: 0.7, sugar: 0.4, fiber: 0, sodium: 142, serving: "1 large egg ≈ 50g" },
  { name: "Fish, white (cod/tilapia type), cooked", kcal: 110, protein: 23, fat: 1.5, carbs: 0, sugar: 0, fiber: 0, sodium: 78 },
  { name: "Shrimp / prawns, cooked", kcal: 99, protein: 24, fat: 0.3, carbs: 0.2, sugar: 0, fiber: 0, sodium: 111 },
  { name: "Mutton / lamb, cooked", kcal: 294, protein: 25, fat: 21, carbs: 0, sugar: 0, fiber: 0, sodium: 72 },

  // ── sweeteners & nuts ──
  { name: "Sugar, white", kcal: 387, protein: 0, fat: 0, carbs: 100, sugar: 100, fiber: 0, sodium: 1, serving: "1 tsp ≈ 4g" },
  { name: "Jaggery (gur)", kcal: 383, protein: 0.4, fat: 0.1, carbs: 98, sugar: 90, fiber: 0, sodium: 40 },
  { name: "Honey", kcal: 304, protein: 0.3, fat: 0, carbs: 82, sugar: 82, fiber: 0.2, sodium: 4 },
  { name: "Almonds", kcal: 579, protein: 21.2, fat: 49.9, carbs: 21.6, sugar: 4.4, fiber: 12.5, sodium: 1 },
  { name: "Peanuts, raw", kcal: 567, protein: 25.8, fat: 49.2, carbs: 16.1, sugar: 4.7, fiber: 8.5, sodium: 18 },
  { name: "Cashews", kcal: 553, protein: 18.2, fat: 43.9, carbs: 30.2, sugar: 5.9, fiber: 3.3, sodium: 12 },

  // ── seasoning ──
  { name: "Salt", kcal: 0, protein: 0, fat: 0, carbs: 0, sugar: 0, fiber: 0, sodium: 38758, serving: "used in small amounts, ~1-3g" },
  { name: "Coriander leaves, fresh", kcal: 23, protein: 2.1, fat: 0.5, carbs: 3.7, sugar: 0.9, fiber: 2.8, sodium: 46 },
  { name: "Turmeric powder", kcal: 312, protein: 9.7, fat: 3.3, carbs: 65, sugar: 3.2, fiber: 21, sodium: 38, serving: "used in tiny amounts, ~1-2g" },
];

function searchCommonIngredients(query, limit = 6) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  const starts = [];
  const contains = [];
  for (const item of COMMON_INGREDIENTS) {
    const n = item.name.toLowerCase();
    if (n.startsWith(q)) starts.push(item);
    else if (n.includes(q)) contains.push(item);
  }
  return [...starts, ...contains].slice(0, limit);
}

export { COMMON_INGREDIENTS, searchCommonIngredients };
