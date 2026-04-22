export interface NotificationMessage {
  subject: string;
  body:    string;
}

export interface NotificationRecipient {
  name:  string;
  email: string;
}

export interface INotificationChannel {
  send(recipient: NotificationRecipient, message: NotificationMessage): Promise<void>;
}