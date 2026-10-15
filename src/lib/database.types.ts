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
      cash_transactions: {
        Row: {
          client_id: string | null
          created_at: string
          credit: number | null
          date: string
          debit: number | null
          description: string | null
          id: string
          import_id: string | null
          kind: string
          method: string
          missing_from_source: boolean
          name_raw: string | null
          owner_id: string
          pos_amount: number | null
          source_key: string
          source_row: number | null
          source_sheet: string | null
          updated_at: string
          voucher: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          credit?: number | null
          date: string
          debit?: number | null
          description?: string | null
          id?: string
          import_id?: string | null
          kind?: string
          method?: string
          missing_from_source?: boolean
          name_raw?: string | null
          owner_id?: string
          pos_amount?: number | null
          source_key: string
          source_row?: number | null
          source_sheet?: string | null
          updated_at?: string
          voucher?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          credit?: number | null
          date?: string
          debit?: number | null
          description?: string | null
          id?: string
          import_id?: string | null
          kind?: string
          method?: string
          missing_from_source?: boolean
          name_raw?: string | null
          owner_id?: string
          pos_amount?: number | null
          source_key?: string
          source_row?: number | null
          source_sheet?: string | null
          updated_at?: string
          voucher?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_transactions_client_id_owner_id_fkey"
            columns: ["client_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "cash_transactions_import_id_owner_id_fkey"
            columns: ["import_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      client_aliases: {
        Row: {
          alias: string
          client_id: string
          created_at: string
          id: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          alias: string
          client_id: string
          created_at?: string
          id?: string
          owner_id?: string
          updated_at?: string
        }
        Update: {
          alias?: string
          client_id?: string
          created_at?: string
          id?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_aliases_client_id_owner_id_fkey"
            columns: ["client_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      clients: {
        Row: {
          active: boolean
          contacts_key: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          owner_id: string
          phone: string | null
          phone_contacts: string | null
          phone_override: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          contacts_key?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          owner_id?: string
          phone?: string | null
          phone_contacts?: string | null
          phone_override?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          contacts_key?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          owner_id?: string
          phone?: string | null
          phone_contacts?: string | null
          phone_override?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      day_reviews: {
        Row: {
          confirmed_at: string | null
          created_at: string
          date: string
          id: string
          notes: string | null
          owner_id: string
          report_generated_at: string | null
          report_storage_path: string | null
          updated_at: string
        }
        Insert: {
          confirmed_at?: string | null
          created_at?: string
          date: string
          id?: string
          notes?: string | null
          owner_id?: string
          report_generated_at?: string | null
          report_storage_path?: string | null
          updated_at?: string
        }
        Update: {
          confirmed_at?: string | null
          created_at?: string
          date?: string
          id?: string
          notes?: string | null
          owner_id?: string
          report_generated_at?: string | null
          report_storage_path?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      day_sessions: {
        Row: {
          approval_id: string | null
          billed: number
          billing_type: string
          cash_transaction_id: string | null
          client_id: string | null
          client_name: string | null
          collected: number
          confirmed: boolean
          created_at: string
          date: string
          extra_note: string | null
          id: string
          owner_id: string
          package_id: string | null
          payment_method: string | null
          schedule_entry_id: string | null
          session_no: number | null
          therapist: string | null
          updated_at: string
        }
        Insert: {
          approval_id?: string | null
          billed?: number
          billing_type: string
          cash_transaction_id?: string | null
          client_id?: string | null
          client_name?: string | null
          collected?: number
          confirmed?: boolean
          created_at?: string
          date: string
          extra_note?: string | null
          id?: string
          owner_id?: string
          package_id?: string | null
          payment_method?: string | null
          schedule_entry_id?: string | null
          session_no?: number | null
          therapist?: string | null
          updated_at?: string
        }
        Update: {
          approval_id?: string | null
          billed?: number
          billing_type?: string
          cash_transaction_id?: string | null
          client_id?: string | null
          client_name?: string | null
          collected?: number
          confirmed?: boolean
          created_at?: string
          date?: string
          extra_note?: string | null
          id?: string
          owner_id?: string
          package_id?: string | null
          payment_method?: string | null
          schedule_entry_id?: string | null
          session_no?: number | null
          therapist?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "day_sessions_approval_id_owner_id_fkey"
            columns: ["approval_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "approval_balances"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "day_sessions_approval_id_owner_id_fkey"
            columns: ["approval_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "insurance_approvals"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "day_sessions_cash_transaction_id_owner_id_fkey"
            columns: ["cash_transaction_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "cash_transactions"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "day_sessions_client_id_owner_id_fkey"
            columns: ["client_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "day_sessions_package_id_owner_id_fkey"
            columns: ["package_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "package_balances"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "day_sessions_package_id_owner_id_fkey"
            columns: ["package_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "day_sessions_schedule_entry_id_owner_id_fkey"
            columns: ["schedule_entry_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "schedule_entries"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      expense_labels: {
        Row: {
          created_at: string
          id: string
          label: string
          match_key: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          match_key: string
          owner_id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          match_key?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      imports: {
        Row: {
          created_at: string
          details: Json | null
          filename: string | null
          id: string
          imported_at: string
          kind: string
          owner_id: string
          rows_added: number
          rows_changed: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          details?: Json | null
          filename?: string | null
          id?: string
          imported_at?: string
          kind: string
          owner_id?: string
          rows_added?: number
          rows_changed?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          details?: Json | null
          filename?: string | null
          id?: string
          imported_at?: string
          kind?: string
          owner_id?: string
          rows_added?: number
          rows_changed?: number
          updated_at?: string
        }
        Relationships: []
      }
      insurance_approvals: {
        Row: {
          approved_on: string | null
          billed_per_session: number
          client_id: string
          copay_per_session: number
          created_at: string
          id: string
          insurer: string
          notes: string | null
          owner_id: string
          serial_number: string | null
          sessions_approved: number
          sessions_used_before_app: number
          status: string
          updated_at: string
          used_before_app_as_of: string | null
          valid_until: string | null
        }
        Insert: {
          approved_on?: string | null
          billed_per_session: number
          client_id: string
          copay_per_session?: number
          created_at?: string
          id?: string
          insurer: string
          notes?: string | null
          owner_id?: string
          serial_number?: string | null
          sessions_approved: number
          sessions_used_before_app?: number
          status?: string
          updated_at?: string
          used_before_app_as_of?: string | null
          valid_until?: string | null
        }
        Update: {
          approved_on?: string | null
          billed_per_session?: number
          client_id?: string
          copay_per_session?: number
          created_at?: string
          id?: string
          insurer?: string
          notes?: string | null
          owner_id?: string
          serial_number?: string | null
          sessions_approved?: number
          sessions_used_before_app?: number
          status?: string
          updated_at?: string
          used_before_app_as_of?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "insurance_approvals_client_id_owner_id_fkey"
            columns: ["client_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      non_client_patterns: {
        Row: {
          created_at: string
          id: string
          match_type: string
          owner_id: string
          pattern: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          match_type: string
          owner_id?: string
          pattern: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          match_type?: string
          owner_id?: string
          pattern?: string
          updated_at?: string
        }
        Relationships: []
      }
      packages: {
        Row: {
          amount_paid: number | null
          client_id: string
          created_at: string
          id: string
          notes: string | null
          owner_id: string
          per_session: number
          price_total: number
          purchased_on: string | null
          sessions_total: number
          sessions_used_before_app: number
          source_voucher: string | null
          status: string
          updated_at: string
          used_before_app_as_of: string | null
        }
        Insert: {
          amount_paid?: number | null
          client_id: string
          created_at?: string
          id?: string
          notes?: string | null
          owner_id?: string
          per_session: number
          price_total: number
          purchased_on?: string | null
          sessions_total: number
          sessions_used_before_app?: number
          source_voucher?: string | null
          status?: string
          updated_at?: string
          used_before_app_as_of?: string | null
        }
        Update: {
          amount_paid?: number | null
          client_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          owner_id?: string
          per_session?: number
          price_total?: number
          purchased_on?: string | null
          sessions_total?: number
          sessions_used_before_app?: number
          source_voucher?: string | null
          status?: string
          updated_at?: string
          used_before_app_as_of?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "packages_client_id_owner_id_fkey"
            columns: ["client_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      reminders: {
        Row: {
          client_id: string
          created_at: string
          date: string
          id: string
          owner_id: string
          phone_used: string | null
          sent_at: string | null
          slot_time: string
          therapist: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          date: string
          id?: string
          owner_id?: string
          phone_used?: string | null
          sent_at?: string | null
          slot_time: string
          therapist?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          date?: string
          id?: string
          owner_id?: string
          phone_used?: string | null
          sent_at?: string | null
          slot_time?: string
          therapist?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminders_client_id_owner_id_fkey"
            columns: ["client_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      schedule_entries: {
        Row: {
          billing_note: string | null
          cell_ref: string | null
          client_id: string | null
          created_at: string
          date: string
          id: string
          import_id: string | null
          inline_amount: number | null
          is_non_client: boolean
          match_kind: string | null
          name_key: string | null
          owner_id: string
          parsed_name: string | null
          raw_text: string
          session_no: number | null
          sheet_tab: string | null
          slot_time: string
          status: string
          therapist: string
          updated_at: string
        }
        Insert: {
          billing_note?: string | null
          cell_ref?: string | null
          client_id?: string | null
          created_at?: string
          date: string
          id?: string
          import_id?: string | null
          inline_amount?: number | null
          is_non_client?: boolean
          match_kind?: string | null
          name_key?: string | null
          owner_id?: string
          parsed_name?: string | null
          raw_text: string
          session_no?: number | null
          sheet_tab?: string | null
          slot_time: string
          status?: string
          therapist: string
          updated_at?: string
        }
        Update: {
          billing_note?: string | null
          cell_ref?: string | null
          client_id?: string | null
          created_at?: string
          date?: string
          id?: string
          import_id?: string | null
          inline_amount?: number | null
          is_non_client?: boolean
          match_kind?: string | null
          name_key?: string | null
          owner_id?: string
          parsed_name?: string | null
          raw_text?: string
          session_no?: number | null
          sheet_tab?: string | null
          slot_time?: string
          status?: string
          therapist?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_entries_client_id_owner_id_fkey"
            columns: ["client_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "schedule_entries_import_id_owner_id_fkey"
            columns: ["import_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      settings: {
        Row: {
          created_at: string
          id: string
          key: string
          owner_id: string
          updated_at: string
          value: Json
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          owner_id?: string
          updated_at?: string
          value: Json
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          owner_id?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
    }
    Views: {
      approval_balances: {
        Row: {
          approved_on: string | null
          billed_per_session: number | null
          client_id: string | null
          copay_per_session: number | null
          created_at: string | null
          id: string | null
          insurer: string | null
          last_session_on: string | null
          notes: string | null
          owner_id: string | null
          serial_number: string | null
          sessions_approved: number | null
          sessions_remaining: number | null
          sessions_used: number | null
          sessions_used_before_app: number | null
          sessions_used_in_app: number | null
          status: string | null
          updated_at: string | null
          used_before_app_as_of: string | null
          valid_until: string | null
        }
        Relationships: [
          {
            foreignKeyName: "insurance_approvals_client_id_owner_id_fkey"
            columns: ["client_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      package_balances: {
        Row: {
          amount_paid: number | null
          client_id: string | null
          created_at: string | null
          id: string | null
          last_session_on: string | null
          notes: string | null
          owner_id: string | null
          per_session: number | null
          price_total: number | null
          purchased_on: string | null
          sessions_remaining: number | null
          sessions_total: number | null
          sessions_used: number | null
          sessions_used_before_app: number | null
          sessions_used_in_app: number | null
          source_voucher: string | null
          status: string | null
          updated_at: string | null
          used_before_app_as_of: string | null
        }
        Relationships: [
          {
            foreignKeyName: "packages_client_id_owner_id_fkey"
            columns: ["client_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
    }
    Functions: {
      table_security_report: {
        Args: never
        Returns: {
          anon_has_access: boolean
          has_owner_id: boolean
          kind: string
          policy_count: number
          rls_enabled: boolean
          security_invoker: boolean
          table_name: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
