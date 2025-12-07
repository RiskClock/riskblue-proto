-- Create table to store detailed AI analysis results for assets, water systems, and processes
CREATE TABLE public.project_analysis_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    item_id text NOT NULL,
    name text NOT NULL,
    category text NOT NULL CHECK (category IN ('Asset', 'Water System', 'Process')),
    area_name text,
    floor text,
    drawing_code text,
    file_name text,
    width numeric,
    length numeric,
    size_category text CHECK (size_category IN ('small', 'medium', 'large', 'very large') OR size_category IS NULL),
    controls text[], -- Array of control names
    coordinates numeric[], -- Array of 4 numbers [x_start, y_start, x_end, y_end]
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create index for faster project lookups
CREATE INDEX idx_project_analysis_items_project_id ON public.project_analysis_items(project_id);
CREATE INDEX idx_project_analysis_items_category ON public.project_analysis_items(category);

-- Enable Row Level Security
ALTER TABLE public.project_analysis_items ENABLE ROW LEVEL SECURITY;

-- Create policies for user access (same as other project-related tables)
CREATE POLICY "Users can view analysis items for their projects"
ON public.project_analysis_items FOR SELECT
USING (EXISTS (
    SELECT 1 FROM projects
    WHERE projects.id = project_analysis_items.project_id
    AND projects.user_id = auth.uid()
));

CREATE POLICY "Users can insert analysis items for their projects"
ON public.project_analysis_items FOR INSERT
WITH CHECK (EXISTS (
    SELECT 1 FROM projects
    WHERE projects.id = project_analysis_items.project_id
    AND projects.user_id = auth.uid()
));

CREATE POLICY "Users can update analysis items for their projects"
ON public.project_analysis_items FOR UPDATE
USING (EXISTS (
    SELECT 1 FROM projects
    WHERE projects.id = project_analysis_items.project_id
    AND projects.user_id = auth.uid()
));

CREATE POLICY "Users can delete analysis items for their projects"
ON public.project_analysis_items FOR DELETE
USING (EXISTS (
    SELECT 1 FROM projects
    WHERE projects.id = project_analysis_items.project_id
    AND projects.user_id = auth.uid()
));

-- Add trigger for automatic timestamp updates
CREATE TRIGGER update_project_analysis_items_updated_at
BEFORE UPDATE ON public.project_analysis_items
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();