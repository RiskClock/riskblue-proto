-- Update "Kitchens & Washrooms" to singular "Kitchen & Washroom" to match mock data naming convention
UPDATE critical_assets 
SET name = 'Kitchen & Washroom' 
WHERE name = 'Kitchens & Washrooms';