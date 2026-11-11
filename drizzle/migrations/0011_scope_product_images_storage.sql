DROP POLICY IF EXISTS "Signed-in users can read product images" ON storage.objects;
DROP POLICY IF EXISTS "Signed-in users can update product images" ON storage.objects;
DROP POLICY IF EXISTS "Signed-in users can delete product images" ON storage.objects;

CREATE POLICY "Company members can read product images" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  AND public.is_tenant_member((select auth.uid()), ((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "Company editors can update product images" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  AND public.can_manage_tenant_controls((select auth.uid()), ((storage.foldername(name))[1])::uuid)
)
WITH CHECK (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  AND public.can_manage_tenant_controls((select auth.uid()), ((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "Company editors can delete product images" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  AND public.can_manage_tenant_controls((select auth.uid()), ((storage.foldername(name))[1])::uuid)
);