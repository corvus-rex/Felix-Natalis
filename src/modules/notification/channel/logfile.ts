import { promises as fs } from 'fs';
import path from 'path';
import { INotificationChannel, NotificationMessage, NotificationRecipient } from '../model.js';
import { config } from '../../../config/index.js';

export class LogFileChannel implements INotificationChannel {
  private readonly logDir: string;

  constructor(logDir: string = config.channel.logFileDir) {
    this.logDir = logDir;
  }

  async send(
    recipient: NotificationRecipient,
    message:   NotificationMessage,
  ): Promise<void> {
    await fs.mkdir(this.logDir, { recursive: true });

    // Unique filename per notification — no two jobs ever write to the same file
    // Format: birthday_<userId>_<scheduledAt-safe>.log
    const safeTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName      = `birthday_${recipient.userId}_${safeTimestamp}.log`;
    const filePath      = path.join(this.logDir, fileName);

    await fs.writeFile(filePath, this.formatLog(recipient, message), 'utf-8');
  }

  private formatLog(
    recipient: NotificationRecipient,
    message:   NotificationMessage,
  ): string {
    return [
      '-----',
      `To: ${recipient.name} <${recipient.email}>`,
      `Subject: ${message.subject}`,
      'Body:',
      message.body,
      '--------------',
    ].join('\n');
  }
}