export type PaymentNotificationEvent = "payment_initiated" | "payment_pending" | "payment_verified" | "payment_failed" | "payment_refunded" | "receipt_available";

export interface PaymentNotification {
  event: PaymentNotificationEvent;
  institutionId: string;
  paymentId: string;
  recipientUid?: string | null;
  metadata?: Record<string, unknown>;
}

export type PaymentNotificationPublisher = (notification: PaymentNotification) => Promise<void>;

export async function publishPaymentNotification(publisher: PaymentNotificationPublisher | undefined, notification: PaymentNotification) {
  if (publisher) await publisher(notification);
}
