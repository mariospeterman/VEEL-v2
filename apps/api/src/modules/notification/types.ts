import type { components } from "@veel/contracts";

export type Notification = components["schemas"]["Notification"];
export type NotificationDevice = components["schemas"]["NotificationDevice"];
export type NotificationPage = components["schemas"]["NotificationPage"];
export type NotificationPreferences = components["schemas"]["NotificationPreferences"];
export type NotificationPushConfig = components["schemas"]["NotificationPushConfig"];
export type RegisterNotificationDeviceRequest = components["schemas"]["RegisterNotificationDeviceRequest"];
export type UpdateNotificationPreferencesRequest = components["schemas"]["UpdateNotificationPreferencesRequest"];

export interface ListNotificationsInput {
  supabaseUserId: string;
  limit: number;
  cursor?: string;
}

export interface RegisterNotificationDeviceInput {
  supabaseUserId: string;
  body: RegisterNotificationDeviceRequest;
  idempotencyKey: string;
}

export interface NotificationRepository {
  listNotifications(input: ListNotificationsInput): Promise<NotificationPage>;
  markRead(input: { supabaseUserId: string; notificationId: string; idempotencyKey: string }): Promise<Notification | null>;
  getPreferences(input: { supabaseUserId: string }): Promise<NotificationPreferences>;
  updatePreferences(input: {
    supabaseUserId: string;
    body: UpdateNotificationPreferencesRequest;
    idempotencyKey: string;
  }): Promise<NotificationPreferences>;
  registerDevice(input: RegisterNotificationDeviceInput): Promise<NotificationDevice>;
  deleteDevice(input: { supabaseUserId: string; notificationDeviceId: string; idempotencyKey: string }): Promise<boolean>;
  close?(): Promise<void>;
}
