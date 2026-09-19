ALTER TABLE public.tenant_products
ADD COLUMN pipe_diameter_inches numeric;

ALTER TABLE public.tenant_products
ADD CONSTRAINT tenant_products_pipe_diameter_inches_nonnegative
CHECK (pipe_diameter_inches IS NULL OR pipe_diameter_inches >= 0);