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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      claim_favorites: {
        Row: {
          claim_id: string
          created_at: string
          project_id: string
          user_id: string
        }
        Insert: {
          claim_id: string
          created_at?: string
          project_id: string
          user_id?: string
        }
        Update: {
          claim_id?: string
          created_at?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_favorites_project_id_claim_id_fkey"
            columns: ["project_id", "claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["project_id", "id"]
          },
        ]
      }
      claim_history: {
        Row: {
          at: string
          by: string
          by_name: string | null
          changes: Json
          claim_id: string
          id: string
          project_id: string
          type: string
        }
        Insert: {
          at?: string
          by: string
          by_name?: string | null
          changes?: Json
          claim_id: string
          id?: string
          project_id: string
          type: string
        }
        Update: {
          at?: string
          by?: string
          by_name?: string | null
          changes?: Json
          claim_id?: string
          id?: string
          project_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_history_project_id_claim_id_fkey"
            columns: ["project_id", "claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["project_id", "id"]
          },
        ]
      }
      claim_payments: {
        Row: {
          amount: number
          claim_id: string
          discount_percent: number | null
          id: string
          kind: string
          paid_on: string
          project_id: string
          review_note: string
          reviewed_at: string | null
          reviewed_by: string | null
          state: string
          status_id: string
          submitted_at: string
          submitted_by: string
        }
        Insert: {
          amount: number
          claim_id: string
          discount_percent?: number | null
          id?: string
          kind: string
          paid_on?: string
          project_id: string
          review_note?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          state?: string
          status_id: string
          submitted_at?: string
          submitted_by: string
        }
        Update: {
          amount?: number
          claim_id?: string
          discount_percent?: number | null
          id?: string
          kind?: string
          paid_on?: string
          project_id?: string
          review_note?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          state?: string
          status_id?: string
          submitted_at?: string
          submitted_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_payments_project_id_claim_id_fkey"
            columns: ["project_id", "claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["project_id", "id"]
          },
        ]
      }
      claims: {
        Row: {
          amount: number
          approved_paid: number
          assigned_at: string | null
          assigned_by: string | null
          assignee: string | null
          batch_id: string | null
          coded: boolean
          coded_at: string | null
          created_at: string
          data: Json
          follow_up_date: string
          id: string
          last_note: string
          note: string
          paid: number
          project_id: string
          seq: number
          settlement_amount: number | null
          status: string | null
          updated_at: string | null
          updated_by: string | null
          updated_by_name: string | null
        }
        Insert: {
          amount?: number
          approved_paid?: number
          assigned_at?: string | null
          assigned_by?: string | null
          assignee?: string | null
          batch_id?: string | null
          coded?: boolean
          coded_at?: string | null
          created_at?: string
          data?: Json
          follow_up_date?: string
          id: string
          last_note?: string
          note?: string
          paid?: number
          project_id: string
          seq?: number
          settlement_amount?: number | null
          status?: string | null
          updated_at?: string | null
          updated_by?: string | null
          updated_by_name?: string | null
        }
        Update: {
          amount?: number
          approved_paid?: number
          assigned_at?: string | null
          assigned_by?: string | null
          assignee?: string | null
          batch_id?: string | null
          coded?: boolean
          coded_at?: string | null
          created_at?: string
          data?: Json
          follow_up_date?: string
          id?: string
          last_note?: string
          note?: string
          paid?: number
          project_id?: string
          seq?: number
          settlement_amount?: number | null
          status?: string | null
          updated_at?: string | null
          updated_by?: string | null
          updated_by_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "claims_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      coding_requests: {
        Row: {
          claim_id: string
          id: string
          note: string
          project_id: string
          requested_at: string
          requested_by: string
          review_note: string
          reviewed_at: string | null
          reviewed_by: string | null
          state: string
        }
        Insert: {
          claim_id: string
          id?: string
          note?: string
          project_id: string
          requested_at?: string
          requested_by?: string
          review_note?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          state?: string
        }
        Update: {
          claim_id?: string
          id?: string
          note?: string
          project_id?: string
          requested_at?: string
          requested_by?: string
          review_note?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "coding_requests_project_id_claim_id_fkey"
            columns: ["project_id", "claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["project_id", "id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          name: string
          project_ids: string[]
          username: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id: string
          name: string
          project_ids?: string[]
          username: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          project_ids?: string[]
          username?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          added_columns: string[]
          columns: Json
          created_at: string
          created_by: string | null
          display_cols: Json
          id: string
          mapping: Json
          name: string
          statuses: Json
        }
        Insert: {
          added_columns?: string[]
          columns?: Json
          created_at?: string
          created_by?: string | null
          display_cols?: Json
          id?: string
          mapping?: Json
          name: string
          statuses?: Json
        }
        Update: {
          added_columns?: string[]
          columns?: Json
          created_at?: string
          created_by?: string | null
          display_cols?: Json
          id?: string
          mapping?: Json
          name?: string
          statuses?: Json
        }
        Relationships: []
      }
      reminder_seen: {
        Row: {
          claim_id: string
          due_date: string
          project_id: string
          seen_at: string
          user_id: string
        }
        Insert: {
          claim_id: string
          due_date: string
          project_id: string
          seen_at?: string
          user_id?: string
        }
        Update: {
          claim_id?: string
          due_date?: string
          project_id?: string
          seen_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminder_seen_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_manage: { Args: { p: string }; Returns: boolean }
      can_review_payment_row: {
        Args: { p: Database["public"]["Tables"]["claim_payments"]["Row"] }
        Returns: boolean
      }
      can_see_user: { Args: { p_uid: string }; Returns: boolean }
      claim_status_name: {
        Args: { p_id: string; p_project: string }
        Returns: string
      }
      delete_claim_batch: {
        Args: { p_batch: string; p_project: string }
        Returns: number
      }
      delete_claim_payment: { Args: { p_id: string }; Returns: undefined }
      is_emp_of: { Args: { p: string }; Returns: boolean }
      my_projects: { Args: never; Returns: string[] }
      my_role: { Args: never; Returns: Database["public"]["Enums"]["app_role"] }
      remove_coding: {
        Args: { p_claim: string; p_project: string }
        Returns: undefined
      }
      request_coding: {
        Args: { p_claim: string; p_note?: string; p_project: string }
        Returns: string
      }
      reset_project_claims: { Args: { p_project: string }; Returns: number }
      review_claim_payment: {
        Args: { p_approve: boolean; p_id: string; p_note?: string }
        Returns: undefined
      }
      review_coding: {
        Args: { p_approve: boolean; p_id: string; p_note?: string }
        Returns: undefined
      }
      save_claim_update: {
        Args: {
          p_claim: string
          p_data?: Json
          p_follow_up?: string
          p_note?: string
          p_project: string
          p_status?: string
        }
        Returns: undefined
      }
      submit_claim_payment: {
        Args: {
          p_amount: number
          p_claim: string
          p_date: string
          p_discount: number
          p_kind: string
          p_project: string
          p_status: string
        }
        Returns: string
      }
      transfer_claims: {
        Args: { p_ids: string[]; p_project: string; p_to: string }
        Returns: number
      }
    }
    Enums: {
      app_role: "owner" | "exec" | "supervisor" | "employee"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["owner", "exec", "supervisor", "employee"],
    },
  },
} as const
