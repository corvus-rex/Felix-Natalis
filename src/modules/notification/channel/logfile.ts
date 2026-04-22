import { promises as fs } from 'fs';
import path from 'path';
import { INotificationChannel, NotificationMessage, NotificationRecipient} from '../model.js';

export class LogFileChannel implements INotificationChannel {
  private readonly filePath: string;

  constructor(logDir: string = './logs') {
    this.filePath = path.join(logDir, 'notifications.log');
  }

  async send(recipient: NotificationRecipient, message: NotificationMessage): Promise<void> {
    const entry = this.formatLog(recipient, message);

    // ensure directory exists
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    // append safely (atomic per write in most systems)
    await fs.appendFile(this.filePath, entry, 'utf-8');
  }

  private formatLog(recipient: NotificationRecipient, message: NotificationMessage): string {

    return [
      `-----`,
      `To: ${recipient.name} <${recipient.email}>`,
      `Subject: ${message.subject}`,
      `Body:`,
      message.body,
      `--------------\n`,
    ].join('\n');
  }
}