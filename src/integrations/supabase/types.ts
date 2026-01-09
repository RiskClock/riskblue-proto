export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      awp_class_control_mappings: {
        Row: {
          awp_class_id: string | null
          awp_class_name: string
          control_id: string
          created_at: string | null
          id: string
        }
        Insert: {
          awp_class_id?: string | null
          awp_class_name: string
          control_id: string
          created_at?: string | null
          id?: string
        }
        Update: {
          awp_class_id?: string | null
          awp_class_name?: string
          control_id?: string
          created_at?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "awp_class_control_mappings_awp_class_id_fkey"
            columns: ["awp_class_id"]
            isOneToOne: false
            referencedRelation: "awp_classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "awp_class_control_mappings_control_id_fkey"
            columns: ["control_id"]
            isOneToOne: false
            referencedRelation: "mitigation_controls"
            referencedColumns: ["id"]
          },
        ]
      }
      awp_classes: {
        Row: {
          category: string
          created_at: string | null
          display_order: number | null
          id: string
          id_prefix: string
          is_active: boolean | null
          name: string
        }
        Insert: {
          category: string
          created_at?: string | null
          display_order?: number | null
          id?: string
          id_prefix: string
          is_active?: boolean | null
          name: string
        }
        Update: {
          category?: string
          created_at?: string | null
          display_order?: number | null
          id?: string
          id_prefix?: string
          is_active?: boolean | null
          name?: string
        }
        Relationships: []
      }
      company_proposals: {
        Row: {
          collaborator_id: string
          company: string
          control_id: string
          created_at: string
          details: string | null
          edited_at: string | null
          editor_name: string | null
          id: string
          project_id: string
          status: string | null
          system_cost: number
          system_name: string
          updated_at: string
        }
        Insert: {
          collaborator_id: string
          company: string
          control_id: string
          created_at?: string
          details?: string | null
          edited_at?: string | null
          editor_name?: string | null
          id?: string
          project_id: string
          status?: string | null
          system_cost?: number
          system_name: string
          updated_at?: string
        }
        Update: {
          collaborator_id?: string
          company?: string
          control_id?: string
          created_at?: string
          details?: string | null
          edited_at?: string | null
          editor_name?: string | null
          id?: string
          project_id?: string
          status?: string | null
          system_cost?: number
          system_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_proposals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_company_proposals_collaborator"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "project_collaborators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_company_proposals_control"
            columns: ["control_id"]
            isOneToOne: false
            referencedRelation: "mitigation_controls"
            referencedColumns: ["id"]
          },
        ]
      }
      control_assets: {
        Row: {
          asset_name: string
          control_id: string
        }
        Insert: {
          asset_name: string
          control_id: string
        }
        Update: {
          asset_name?: string
          control_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "control_assets_control_id_fkey"
            columns: ["control_id"]
            isOneToOne: false
            referencedRelation: "mitigation_controls"
            referencedColumns: ["id"]
          },
        ]
      }
      control_comments: {
        Row: {
          comment: string
          control_name: string
          created_at: string
          id: string
          project_id: string
          user_name: string
        }
        Insert: {
          comment: string
          control_name: string
          created_at?: string
          id?: string
          project_id: string
          user_name: string
        }
        Update: {
          comment?: string
          control_name?: string
          created_at?: string
          id?: string
          project_id?: string
          user_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "control_comments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      control_pricing_tiers: {
        Row: {
          control_name: string
          created_at: string
          id: string
          max_value: number | null
          min_value: number | null
          monthly_cost: number
          one_time_cost: number
          tier_label: string
          tier_type: string
          unit: string
          updated_at: string
        }
        Insert: {
          control_name: string
          created_at?: string
          id?: string
          max_value?: number | null
          min_value?: number | null
          monthly_cost?: number
          one_time_cost?: number
          tier_label: string
          tier_type: string
          unit: string
          updated_at?: string
        }
        Update: {
          control_name?: string
          created_at?: string
          id?: string
          max_value?: number | null
          min_value?: number | null
          monthly_cost?: number
          one_time_cost?: number
          tier_label?: string
          tier_type?: string
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      control_systems: {
        Row: {
          control_id: string
          system_name: string
        }
        Insert: {
          control_id: string
          system_name: string
        }
        Update: {
          control_id?: string
          system_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "control_systems_control_id_fkey"
            columns: ["control_id"]
            isOneToOne: false
            referencedRelation: "mitigation_controls"
            referencedColumns: ["id"]
          },
        ]
      }
      critical_assets: {
        Row: {
          cost: string
          created_at: string
          default_control_ids: string[]
          display_order: number
          duration: string | null
          end_date_formula: string | null
          id: string
          id_prefix: string | null
          image_url: string
          impact: number
          is_active: boolean
          name: string
          probability: number
          risk_level: string
          risk_level_points: number
          risk_tolerance: number | null
          start_date_formula: string | null
          threat: string
          updated_at: string
        }
        Insert: {
          cost: string
          created_at?: string
          default_control_ids?: string[]
          display_order?: number
          duration?: string | null
          end_date_formula?: string | null
          id?: string
          id_prefix?: string | null
          image_url: string
          impact?: number
          is_active?: boolean
          name: string
          probability?: number
          risk_level: string
          risk_level_points?: number
          risk_tolerance?: number | null
          start_date_formula?: string | null
          threat: string
          updated_at?: string
        }
        Update: {
          cost?: string
          created_at?: string
          default_control_ids?: string[]
          display_order?: number
          duration?: string | null
          end_date_formula?: string | null
          id?: string
          id_prefix?: string | null
          image_url?: string
          impact?: number
          is_active?: boolean
          name?: string
          probability?: number
          risk_level?: string
          risk_level_points?: number
          risk_tolerance?: number | null
          start_date_formula?: string | null
          threat?: string
          updated_at?: string
        }
        Relationships: []
      }
      custom_critical_assets: {
        Row: {
          cost: string
          created_at: string
          duration: string
          id: string
          name: string
          project_id: string
          risk_level: string
          updated_at: string
        }
        Insert: {
          cost: string
          created_at?: string
          duration: string
          id?: string
          name: string
          project_id: string
          risk_level: string
          updated_at?: string
        }
        Update: {
          cost?: string
          created_at?: string
          duration?: string
          id?: string
          name?: string
          project_id?: string
          risk_level?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_critical_assets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_water_systems: {
        Row: {
          cost: string
          created_at: string
          duration: string
          id: string
          name: string
          project_id: string
          risk_level: string
          updated_at: string
        }
        Insert: {
          cost: string
          created_at?: string
          duration: string
          id?: string
          name: string
          project_id: string
          risk_level: string
          updated_at?: string
        }
        Update: {
          cost?: string
          created_at?: string
          duration?: string
          id?: string
          name?: string
          project_id?: string
          risk_level?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_water_systems_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      mitigation_controls: {
        Row: {
          action: string
          application_component: string | null
          author: string
          category: string
          concept_hours: number | null
          created_at: string
          description: string
          description_summary: string | null
          display_order: number
          estimated_cost: number | null
          hourly_rate: number | null
          id: string
          image_url: string
          is_active: boolean
          monthly_maint_cost: number | null
          monthly_maint_hours: number | null
          name: string
          one_time_cost: number | null
          points: number
          popularity: number
          responsible: string
          risk_tolerance: number | null
          systems_at_risk: string | null
          updated_at: string
        }
        Insert: {
          action: string
          application_component?: string | null
          author: string
          category: string
          concept_hours?: number | null
          created_at?: string
          description: string
          description_summary?: string | null
          display_order?: number
          estimated_cost?: number | null
          hourly_rate?: number | null
          id?: string
          image_url: string
          is_active?: boolean
          monthly_maint_cost?: number | null
          monthly_maint_hours?: number | null
          name: string
          one_time_cost?: number | null
          points?: number
          popularity?: number
          responsible: string
          risk_tolerance?: number | null
          systems_at_risk?: string | null
          updated_at?: string
        }
        Update: {
          action?: string
          application_component?: string | null
          author?: string
          category?: string
          concept_hours?: number | null
          created_at?: string
          description?: string
          description_summary?: string | null
          display_order?: number
          estimated_cost?: number | null
          hourly_rate?: number | null
          id?: string
          image_url?: string
          is_active?: boolean
          monthly_maint_cost?: number | null
          monthly_maint_hours?: number | null
          name?: string
          one_time_cost?: number | null
          points?: number
          popularity?: number
          responsible?: string
          risk_tolerance?: number | null
          systems_at_risk?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      processes: {
        Row: {
          cost: string
          created_at: string
          default_control_ids: string[]
          display_order: number
          duration: string | null
          end_date_formula: string | null
          id: string
          id_prefix: string | null
          image_url: string
          impact: number
          is_active: boolean
          name: string
          probability: number
          risk_level: string
          risk_level_points: number
          risk_tolerance: number
          start_date_formula: string | null
          threat: string
          updated_at: string
        }
        Insert: {
          cost: string
          created_at?: string
          default_control_ids?: string[]
          display_order?: number
          duration?: string | null
          end_date_formula?: string | null
          id?: string
          id_prefix?: string | null
          image_url?: string
          impact?: number
          is_active?: boolean
          name: string
          probability?: number
          risk_level: string
          risk_level_points?: number
          risk_tolerance?: number
          start_date_formula?: string | null
          threat: string
          updated_at?: string
        }
        Update: {
          cost?: string
          created_at?: string
          default_control_ids?: string[]
          display_order?: number
          duration?: string | null
          end_date_formula?: string | null
          id?: string
          id_prefix?: string | null
          image_url?: string
          impact?: number
          is_active?: boolean
          name?: string
          probability?: number
          risk_level?: string
          risk_level_points?: number
          risk_tolerance?: number
          start_date_formula?: string | null
          threat?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      project_analysis_items: {
        Row: {
          additional_parameters: Json | null
          area_name: string | null
          area_sqft: number | null
          awp_class_id: string | null
          category: string
          controls: string[] | null
          coordinates: number[] | null
          created_at: string
          drawing_code: string | null
          drawing_url: string | null
          file_name: string | null
          floor: string | null
          id: string
          item_id: string
          length: number | null
          name: string
          project_id: string
          size_category: string | null
          updated_at: string
          width: number | null
        }
        Insert: {
          additional_parameters?: Json | null
          area_name?: string | null
          area_sqft?: number | null
          awp_class_id?: string | null
          category: string
          controls?: string[] | null
          coordinates?: number[] | null
          created_at?: string
          drawing_code?: string | null
          drawing_url?: string | null
          file_name?: string | null
          floor?: string | null
          id?: string
          item_id: string
          length?: number | null
          name: string
          project_id: string
          size_category?: string | null
          updated_at?: string
          width?: number | null
        }
        Update: {
          additional_parameters?: Json | null
          area_name?: string | null
          area_sqft?: number | null
          awp_class_id?: string | null
          category?: string
          controls?: string[] | null
          coordinates?: number[] | null
          created_at?: string
          drawing_code?: string | null
          drawing_url?: string | null
          file_name?: string | null
          floor?: string | null
          id?: string
          item_id?: string
          length?: number | null
          name?: string
          project_id?: string
          size_category?: string | null
          updated_at?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "project_analysis_items_awp_class_id_fkey"
            columns: ["awp_class_id"]
            isOneToOne: false
            referencedRelation: "awp_classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_analysis_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_collaborators: {
        Row: {
          company: string
          created_at: string
          email: string
          id: string
          name: string
          project_id: string
          updated_at: string
        }
        Insert: {
          company: string
          created_at?: string
          email: string
          id?: string
          name: string
          project_id: string
          updated_at?: string
        }
        Update: {
          company?: string
          created_at?: string
          email?: string
          id?: string
          name?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_collaborators_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          name: string
          project_id: string
          role: Database["public"]["Enums"]["project_role"]
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          name: string
          project_id: string
          role?: Database["public"]["Enums"]["project_role"]
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          name?: string
          project_id?: string
          role?: Database["public"]["Enums"]["project_role"]
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_invitations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_user_roles: {
        Row: {
          created_at: string
          id: string
          project_id: string
          role: Database["public"]["Enums"]["project_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          role?: Database["public"]["Enums"]["project_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          role?: Database["public"]["Enums"]["project_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_user_roles_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          above_grade_parking: boolean | null
          address_1: string | null
          address_2: string | null
          building_type: string | null
          city: string | null
          construction_end_date: string | null
          construction_start_date: string | null
          country: string | null
          created_at: string
          drive_folder_id: string | null
          filesearch_store_id: string | null
          has_builders_risk_policy: boolean | null
          id: string
          location: string | null
          name: string
          project_data: Json | null
          project_type: string | null
          state: string | null
          status: string | null
          total_floors: number | null
          tower_type: string | null
          typical_floors: number | null
          typical_floors_end: string | null
          typical_floors_start: string | null
          underground_parking: boolean | null
          underground_parking_end: string | null
          underground_parking_start: string | null
          updated_at: string
          user_id: string
          zip_code: string | null
        }
        Insert: {
          above_grade_parking?: boolean | null
          address_1?: string | null
          address_2?: string | null
          building_type?: string | null
          city?: string | null
          construction_end_date?: string | null
          construction_start_date?: string | null
          country?: string | null
          created_at?: string
          drive_folder_id?: string | null
          filesearch_store_id?: string | null
          has_builders_risk_policy?: boolean | null
          id?: string
          location?: string | null
          name: string
          project_data?: Json | null
          project_type?: string | null
          state?: string | null
          status?: string | null
          total_floors?: number | null
          tower_type?: string | null
          typical_floors?: number | null
          typical_floors_end?: string | null
          typical_floors_start?: string | null
          underground_parking?: boolean | null
          underground_parking_end?: string | null
          underground_parking_start?: string | null
          updated_at?: string
          user_id: string
          zip_code?: string | null
        }
        Update: {
          above_grade_parking?: boolean | null
          address_1?: string | null
          address_2?: string | null
          building_type?: string | null
          city?: string | null
          construction_end_date?: string | null
          construction_start_date?: string | null
          country?: string | null
          created_at?: string
          drive_folder_id?: string | null
          filesearch_store_id?: string | null
          has_builders_risk_policy?: boolean | null
          id?: string
          location?: string | null
          name?: string
          project_data?: Json | null
          project_type?: string | null
          state?: string | null
          status?: string | null
          total_floors?: number | null
          tower_type?: string | null
          typical_floors?: number | null
          typical_floors_end?: string | null
          typical_floors_start?: string | null
          underground_parking?: boolean | null
          underground_parking_end?: string | null
          underground_parking_start?: string | null
          updated_at?: string
          user_id?: string
          zip_code?: string | null
        }
        Relationships: []
      }
      proposals: {
        Row: {
          company_name: string
          contact_email: string
          contact_phone: string | null
          created_at: string
          id: string
          project_id: string
          proposal_details: string | null
          proposed_cost: number
          status: string | null
          submitted_at: string
          updated_at: string
        }
        Insert: {
          company_name: string
          contact_email: string
          contact_phone?: string | null
          created_at?: string
          id?: string
          project_id: string
          proposal_details?: string | null
          proposed_cost: number
          status?: string | null
          submitted_at?: string
          updated_at?: string
        }
        Update: {
          company_name?: string
          contact_email?: string
          contact_phone?: string | null
          created_at?: string
          id?: string
          project_id?: string
          proposal_details?: string | null
          proposed_cost?: number
          status?: string | null
          submitted_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_activity_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          metadata: Json | null
          project_id: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          metadata?: Json | null
          project_id?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          project_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_activity_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_drive_tokens: {
        Row: {
          access_token: string
          created_at: string | null
          encrypted_access_token: string | null
          encrypted_refresh_token: string | null
          google_email: string | null
          id: string
          is_encrypted: boolean | null
          refresh_token: string | null
          token_expiry: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string | null
          encrypted_access_token?: string | null
          encrypted_refresh_token?: string | null
          google_email?: string | null
          id?: string
          is_encrypted?: boolean | null
          refresh_token?: string | null
          token_expiry?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string | null
          encrypted_access_token?: string | null
          encrypted_refresh_token?: string | null
          google_email?: string | null
          id?: string
          is_encrypted?: boolean | null
          refresh_token?: string | null
          token_expiry?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      water_systems: {
        Row: {
          cost: string
          created_at: string
          default_control_ids: string[]
          display_order: number
          duration: string | null
          end_date_formula: string | null
          id: string
          id_prefix: string | null
          image_url: string
          impact: number
          is_active: boolean
          name: string
          probability: number
          risk_level: string
          risk_level_points: number
          risk_tolerance: number | null
          start_date_formula: string | null
          threat: string
          updated_at: string
        }
        Insert: {
          cost: string
          created_at?: string
          default_control_ids?: string[]
          display_order?: number
          duration?: string | null
          end_date_formula?: string | null
          id?: string
          id_prefix?: string | null
          image_url: string
          impact?: number
          is_active?: boolean
          name: string
          probability?: number
          risk_level: string
          risk_level_points?: number
          risk_tolerance?: number | null
          start_date_formula?: string | null
          threat: string
          updated_at?: string
        }
        Update: {
          cost?: string
          created_at?: string
          default_control_ids?: string[]
          display_order?: number
          duration?: string | null
          end_date_formula?: string | null
          id?: string
          id_prefix?: string | null
          image_url?: string
          impact?: number
          is_active?: boolean
          name?: string
          probability?: number
          risk_level?: string
          risk_level_points?: number
          risk_tolerance?: number | null
          start_date_formula?: string | null
          threat?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_project_role: {
        Args: {
          _project_id: string
          _role: Database["public"]["Enums"]["project_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_internal_user: { Args: { _user_id: string }; Returns: boolean }
      is_project_member: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      project_role: "admin" | "contributor"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
      project_role: ["admin", "contributor"],
    },
  },
} as const
