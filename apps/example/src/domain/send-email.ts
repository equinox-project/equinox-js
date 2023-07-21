export interface ISendEmails {
  sendEmail(to: string, title: string, body: string): Promise<void>
}

export class EmailSender implements ISendEmails {
  async sendEmail(to: string, title: string, body: string): Promise<void> {}
}
