-- Existing DietaryNeed rows predate allergen categories and described food and
-- drink needs. The non-null default both preserves every row and classifies all
-- existing records as food-related without guessing a different allergen.
ALTER TABLE `DietaryNeed`
    ADD COLUMN `allergyCategory` ENUM('FOOD', 'MEDICATION', 'ENVIRONMENTAL', 'OTHER') NOT NULL DEFAULT 'FOOD';
