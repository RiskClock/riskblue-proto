// Field routing configuration for project data persistence
// Defines which fields are stored as direct table columns vs in project_data JSON

// Direct table columns in the projects table
export const PROJECT_TABLE_COLUMNS = [
  'name',
  'project_type',
  'building_type',
  'tower_type',
  'total_floors',
  'typical_floors',
  'typical_floors_start',
  'typical_floors_end',
  'underground_parking',
  'underground_parking_start',
  'underground_parking_end',
  'above_grade_parking',
  'location',
  'address_1',
  'address_2',
  'city',
  'state',
  'zip_code',
  'country',
  'construction_start_date',
  'construction_end_date',
  'has_builders_risk_policy',
  'status',
  'drive_folder_id',
  'filesearch_store_id',
] as const;

// Fields stored in the project_data JSON column
export const PROJECT_JSON_FIELDS = [
  // Structural types (array)
  'structural_types',
  'has_podium',
  
  // Milestone dates
  'frame_start_date',
  'frame_end_date',
  'enclosure_start_date',
  'enclosure_end_date',
  'mep_start_date',
  'mep_end_date',
  'elevators_start_date',
  'elevators_end_date',
  'fire_start_date',
  'fire_end_date',
  'interior_start_date',
  'interior_end_date',
  
  // Selected items from analysis
  'selectedAssets',
  'selectedSystems',
  'selectedAssetInstances',
  'selectedSystemInstances',
  
  // Risk settings
  'riskTolerance',
  
  // Other JSON data
  'uploadedFiles',
  'webhookResponse',
] as const;

export type TableColumn = typeof PROJECT_TABLE_COLUMNS[number];
export type JsonField = typeof PROJECT_JSON_FIELDS[number];
export type ProjectField = TableColumn | JsonField;

// Check if a field is a table column
export const isTableColumn = (field: string): field is TableColumn => {
  return PROJECT_TABLE_COLUMNS.includes(field as TableColumn);
};

// Check if a field is a JSON field
export const isJsonField = (field: string): field is JsonField => {
  return PROJECT_JSON_FIELDS.includes(field as JsonField);
};

// Separate fields into table columns and JSON fields
export const separateFields = (fields: Record<string, any>) => {
  const tableFields: Record<string, any> = {};
  const jsonFields: Record<string, any> = {};
  
  Object.entries(fields).forEach(([key, value]) => {
    if (isTableColumn(key)) {
      // Handle numeric fields
      if (key === 'total_floors' || key === 'typical_floors') {
        tableFields[key] = value ? parseInt(value) : null;
      } else if (key === 'construction_start_date' || key === 'construction_end_date') {
        tableFields[key] = value || null;
      } else {
        tableFields[key] = value;
      }
    } else {
      // Everything else goes to project_data JSON
      jsonFields[key] = value;
    }
  });
  
  return { tableFields, jsonFields };
};
