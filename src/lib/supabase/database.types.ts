export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: number
          new_data: Json | null
          old_data: Json | null
          record_id: string | null
          table_name: string
        }
        ComputedFields: never
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: never
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: never
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name?: string
        }
        Relationships: []
      }
      clinic_closures: {
        Row: {
          closed_on: string
          id: string
          reason: string | null
        }
        ComputedFields: never
        Insert: {
          closed_on: string
          id?: string
          reason?: string | null
        }
        Update: {
          closed_on?: string
          id?: string
          reason?: string | null
        }
        Relationships: []
      }
      clinic_settings: {
        Row: {
          address: string | null
          auto_confirm: boolean
          booking_policy: string | null
          cancellation_cutoff_hours: number
          cancellation_policy: string | null
          currency: string
          email: string | null
          id: number
          logo_path: string | null
          logo_url: string | null
          map_url: string | null
          max_advance_days: number
          min_notice_minutes: number
          name: string
          payment_instructions: string | null
          pending_expiry_minutes: number
          phone: string | null
          slot_interval_minutes: number
          tagline: string | null
          timezone: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          address?: string | null
          auto_confirm?: boolean
          booking_policy?: string | null
          cancellation_cutoff_hours?: number
          cancellation_policy?: string | null
          currency?: string
          email?: string | null
          id?: number
          logo_path?: string | null
          logo_url?: string | null
          map_url?: string | null
          max_advance_days?: number
          min_notice_minutes?: number
          name: string
          payment_instructions?: string | null
          pending_expiry_minutes?: number
          phone?: string | null
          slot_interval_minutes?: number
          tagline?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          auto_confirm?: boolean
          booking_policy?: string | null
          cancellation_cutoff_hours?: number
          cancellation_policy?: string | null
          currency?: string
          email?: string | null
          id?: number
          logo_path?: string | null
          logo_url?: string | null
          map_url?: string | null
          max_advance_days?: number
          min_notice_minutes?: number
          name?: string
          payment_instructions?: string | null
          pending_expiry_minutes?: number
          phone?: string | null
          slot_interval_minutes?: number
          tagline?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          is_vip: boolean
          phone: string | null
          profile_id: string | null
          tags: string[]
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          email: string
          full_name: string
          id?: string
          is_vip?: boolean
          phone?: string | null
          profile_id?: string | null
          tags?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          is_vip?: boolean
          phone?: string | null
          profile_id?: string | null
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_profile_id_fkey"
            columns: ["profile_id"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          link: string | null
          read_at: string | null
          recipient_id: string
          title: string
          type: string
        }
        ComputedFields: never
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          recipient_id: string
          title: string
          type: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          recipient_id?: string
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["payment_kind"]
          method: Database["public"]["Enums"]["payment_method"]
          proof_path: string | null
          reference_no: string | null
          rejection_reason: string | null
          reservation_id: string
          status: Database["public"]["Enums"]["payment_txn_status"]
          submitted_by: string | null
          verified_at: string | null
          verified_by: string | null
        }
        ComputedFields: never
        Insert: {
          amount: number
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["payment_kind"]
          method: Database["public"]["Enums"]["payment_method"]
          proof_path?: string | null
          reference_no?: string | null
          rejection_reason?: string | null
          reservation_id: string
          status?: Database["public"]["Enums"]["payment_txn_status"]
          submitted_by?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["payment_kind"]
          method?: Database["public"]["Enums"]["payment_method"]
          proof_path?: string | null
          reference_no?: string | null
          rejection_reason?: string | null
          reservation_id?: string
          status?: Database["public"]["Enums"]["payment_txn_status"]
          submitted_by?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_reservation_id_fkey"
            columns: ["reservation_id"]
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_submitted_by_fkey"
            columns: ["submitted_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_verified_by_fkey"
            columns: ["verified_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          is_active: boolean
          phone: string | null
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          full_name?: string
          id: string
          is_active?: boolean
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          is_active?: boolean
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Relationships: []
      }
      reservation_notes: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          reservation_id: string
        }
        ComputedFields: never
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          reservation_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          reservation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservation_notes_author_id_fkey"
            columns: ["author_id"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_notes_reservation_id_fkey"
            columns: ["reservation_id"]
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      reservation_status_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          from_status: Database["public"]["Enums"]["reservation_status"] | null
          id: number
          reason: string | null
          reservation_id: string
          to_status: Database["public"]["Enums"]["reservation_status"]
        }
        ComputedFields: never
        Insert: {
          changed_at?: string
          changed_by?: string | null
          from_status?: Database["public"]["Enums"]["reservation_status"] | null
          id?: never
          reason?: string | null
          reservation_id: string
          to_status: Database["public"]["Enums"]["reservation_status"]
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          from_status?: Database["public"]["Enums"]["reservation_status"] | null
          id?: never
          reason?: string | null
          reservation_id?: string
          to_status?: Database["public"]["Enums"]["reservation_status"]
        }
        Relationships: [
          {
            foreignKeyName: "reservation_status_history_changed_by_fkey"
            columns: ["changed_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_status_history_reservation_id_fkey"
            columns: ["reservation_id"]
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      reservations: {
        Row: {
          amount_paid: number
          blocked_until: string
          contact_email: string
          contact_name: string
          contact_phone: string
          created_at: string
          created_by: string | null
          customer_id: string
          deposit_required: number
          ends_at: string
          expires_at: string | null
          id: string
          patient_notes: string | null
          payment_status: Database["public"]["Enums"]["payment_status"]
          price: number
          reference_code: string
          resource_id: string
          service_id: string
          source: Database["public"]["Enums"]["booking_source"]
          starts_at: string
          status: Database["public"]["Enums"]["reservation_status"]
          status_reason: string | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          amount_paid?: number
          blocked_until: string
          contact_email: string
          contact_name: string
          contact_phone: string
          created_at?: string
          created_by?: string | null
          customer_id: string
          deposit_required?: number
          ends_at: string
          expires_at?: string | null
          id?: string
          patient_notes?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          price: number
          reference_code?: string
          resource_id: string
          service_id: string
          source?: Database["public"]["Enums"]["booking_source"]
          starts_at: string
          status?: Database["public"]["Enums"]["reservation_status"]
          status_reason?: string | null
          updated_at?: string
        }
        Update: {
          amount_paid?: number
          blocked_until?: string
          contact_email?: string
          contact_name?: string
          contact_phone?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string
          deposit_required?: number
          ends_at?: string
          expires_at?: string | null
          id?: string
          patient_notes?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          price?: number
          reference_code?: string
          resource_id?: string
          service_id?: string
          source?: Database["public"]["Enums"]["booking_source"]
          starts_at?: string
          status?: Database["public"]["Enums"]["reservation_status"]
          status_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservations_created_by_fkey"
            columns: ["created_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_customer_id_fkey"
            columns: ["customer_id"]
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_resource_id_fkey"
            columns: ["resource_id"]
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_service_id_fkey"
            columns: ["service_id"]
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      resource_time_off: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          period: unknown
          reason: string | null
          resource_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          period: unknown
          reason?: string | null
          resource_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          period?: unknown
          reason?: string | null
          resource_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_time_off_created_by_fkey"
            columns: ["created_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_time_off_resource_id_fkey"
            columns: ["resource_id"]
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
        ]
      }
      resources: {
        Row: {
          bio: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          profile_id: string | null
          title: string | null
          type: Database["public"]["Enums"]["resource_type"]
        }
        ComputedFields: never
        Insert: {
          bio?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          profile_id?: string | null
          title?: string | null
          type?: Database["public"]["Enums"]["resource_type"]
        }
        Update: {
          bio?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          profile_id?: string | null
          title?: string | null
          type?: Database["public"]["Enums"]["resource_type"]
        }
        Relationships: [
          {
            foreignKeyName: "resources_profile_id_fkey"
            columns: ["profile_id"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      service_categories: {
        Row: {
          id: string
          name: string
          sort_order: number
        }
        ComputedFields: never
        Insert: {
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      service_resources: {
        Row: {
          resource_id: string
          service_id: string
        }
        ComputedFields: never
        Insert: {
          resource_id: string
          service_id: string
        }
        Update: {
          resource_id?: string
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_resources_resource_id_fkey"
            columns: ["resource_id"]
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_resources_service_id_fkey"
            columns: ["service_id"]
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          buffer_minutes: number
          category_id: string | null
          created_at: string
          deposit_amount: number
          description: string | null
          duration_minutes: number
          id: string
          is_active: boolean
          name: string
          photo_path: string | null
          price: number
          requires_approval: boolean
          slug: string
          sort_order: number
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          buffer_minutes?: number
          category_id?: string | null
          created_at?: string
          deposit_amount?: number
          description?: string | null
          duration_minutes: number
          id?: string
          is_active?: boolean
          name: string
          photo_path?: string | null
          price: number
          requires_approval?: boolean
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          buffer_minutes?: number
          category_id?: string | null
          created_at?: string
          deposit_amount?: number
          description?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean
          name?: string
          photo_path?: string | null
          price?: number
          requires_approval?: boolean
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_category_id_fkey"
            columns: ["category_id"]
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      working_hours: {
        Row: {
          end_time: string
          id: string
          resource_id: string
          start_time: string
          weekday: number
        }
        ComputedFields: never
        Insert: {
          end_time: string
          id?: string
          resource_id: string
          start_time: string
          weekday: number
        }
        Update: {
          end_time?: string
          id?: string
          resource_id?: string
          start_time?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "working_hours_resource_id_fkey"
            columns: ["resource_id"]
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      book_appointment: {
        Args: {
          p_email: string
          p_full_name: string
          p_notes?: string
          p_phone: string
          p_resource_id?: string
          p_service_id: string
          p_starts_at: string
        }
        Returns: {
          deposit_required: number
          expires_at: string
          price: number
          reference_code: string
          resource_name: string
          starts_at: string
          status: Database["public"]["Enums"]["reservation_status"]
        }[]
      }
      cancel_booking: {
        Args: { p_email: string; p_reason?: string; p_reference: string }
        Returns: Database["public"]["Enums"]["reservation_status"]
      }
      claim_booking: { Args: { p_reference: string }; Returns: string }
      get_available_slots: {
        Args: { p_date: string; p_resource_id?: string; p_service_id: string }
        Returns: {
          resource_id: string
          resource_name: string
          slot_end: string
          slot_start: string
        }[]
      }
      get_booking: {
        Args: { p_email: string; p_reference: string }
        Returns: {
          amount_paid: number
          can_cancel: boolean
          dentist_name: string
          deposit_required: number
          ends_at: string
          expires_at: string
          payment_status: Database["public"]["Enums"]["payment_status"]
          price: number
          reference_code: string
          service_name: string
          starts_at: string
          status: Database["public"]["Enums"]["reservation_status"]
        }[]
      }
      submit_payment: {
        Args: {
          p_amount: number
          p_email: string
          p_method: Database["public"]["Enums"]["payment_method"]
          p_proof_path?: string
          p_reference: string
          p_reference_no: string
        }
        Returns: string
      }
    }
    Enums: {
      app_role: "owner" | "secretary" | "dentist" | "patient"
      booking_source: "online" | "walk_in" | "phone" | "manual"
      payment_kind: "payment" | "refund"
      payment_method:
        | "cash"
        | "gcash"
        | "maya"
        | "bank_transfer"
        | "card"
        | "online_gateway"
      payment_status:
        | "unpaid"
        | "awaiting_verification"
        | "partially_paid"
        | "paid"
        | "refunded"
        | "failed"
      payment_txn_status:
        | "awaiting_verification"
        | "verified"
        | "rejected"
        | "failed"
      reservation_status:
        | "pending"
        | "confirmed"
        | "checked_in"
        | "in_progress"
        | "completed"
        | "cancelled"
        | "rejected"
        | "no_show"
        | "expired"
      resource_type: "dentist" | "chair" | "room" | "equipment"
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
      app_role: ["owner", "secretary", "dentist", "patient"],
      booking_source: ["online", "walk_in", "phone", "manual"],
      payment_kind: ["payment", "refund"],
      payment_method: [
        "cash",
        "gcash",
        "maya",
        "bank_transfer",
        "card",
        "online_gateway",
      ],
      payment_status: [
        "unpaid",
        "awaiting_verification",
        "partially_paid",
        "paid",
        "refunded",
        "failed",
      ],
      payment_txn_status: [
        "awaiting_verification",
        "verified",
        "rejected",
        "failed",
      ],
      reservation_status: [
        "pending",
        "confirmed",
        "checked_in",
        "in_progress",
        "completed",
        "cancelled",
        "rejected",
        "no_show",
        "expired",
      ],
      resource_type: ["dentist", "chair", "room", "equipment"],
    },
  },
} as const
