// services/notifications.js - Email and SMS Notification Service
const nodemailer = require('nodemailer');
const twilio = require('twilio');

class NotificationService {
  constructor() {
    // Email configuration (using Gmail as example, but supports any SMTP)
    this.emailTransporter = nodemailer.createTransport({
      service: 'gmail', // or 'smtp', 'sendgrid', etc.
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD // Use app-specific password for Gmail
      }
    });

    // SMS configuration (Twilio)
    this.twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
      ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
      : null;

    this.twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
  }

  // Send email notification
  async sendEmail({ to, subject, html, text }) {
    try {
      const mailOptions = {
        from: `SEC Filings Tracker <${process.env.EMAIL_USER}>`,
        to,
        subject,
        text,
        html
      };

      const info = await this.emailTransporter.sendMail(mailOptions);
      console.log('Email sent:', info.messageId);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('Email error:', error);
      return { success: false, error: error.message };
    }
  }

  // Send SMS notification
  async sendSMS({ to, message }) {
    if (!this.twilioClient) {
      console.warn('Twilio not configured. Skipping SMS.');
      return { success: false, error: 'Twilio not configured' };
    }

    try {
      const result = await this.twilioClient.messages.create({
        body: message,
        from: this.twilioPhoneNumber,
        to
      });

      console.log('SMS sent:', result.sid);
      return { success: true, sid: result.sid };
    } catch (error) {
      console.error('SMS error:', error);
      return { success: false, error: error.message };
    }
  }

  // Send new filing alert email
  async sendFilingAlertEmail(user, filings) {
    const subject = `🔔 ${filings.length} New SEC Filing${filings.length > 1 ? 's' : ''} Alert`;
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #2563eb; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 20px; }
          .filing { background: white; margin: 15px 0; padding: 15px; border-left: 4px solid #2563eb; border-radius: 4px; }
          .filing-header { font-weight: bold; color: #1f2937; margin-bottom: 5px; }
          .filing-meta { color: #6b7280; font-size: 14px; margin-bottom: 10px; }
          .filing-type { background: #dbeafe; color: #1e40af; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
          .button { background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin-top: 10px; }
          .footer { text-align: center; color: #6b7280; font-size: 12px; margin-top: 20px; padding-top: 20px; border-top: 1px solid #e5e7eb; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0;">🔔 New SEC Filings Alert</h1>
            <p style="margin: 5px 0 0 0;">You have ${filings.length} new filing${filings.length > 1 ? 's' : ''} from your watchlist</p>
          </div>
          <div class="content">
            <p>Hello ${user.name || 'there'},</p>
            <p>The following SEC filings have been detected for companies on your watchlist:</p>
            
            ${filings.map(filing => `
              <div class="filing">
                <div class="filing-header">${filing.company}</div>
                <div class="filing-meta">
                  <span class="filing-type">${filing.formType}</span>
                  <span style="margin-left: 10px;">Filed: ${new Date(filing.filedDate).toLocaleDateString()}</span>
                </div>
                <p style="margin: 10px 0;">${filing.description}</p>
                <a href="${this.getFilingUrl(filing.accessionNumber, filing.cik)}" class="button">View Filing</a>
              </div>
            `).join('')}
            
            <div class="footer">
              <p>You're receiving this because you have notifications enabled for your SEC Filings Tracker watchlist.</p>
              <p><a href="${process.env.FRONTEND_URL}/settings" style="color: #2563eb;">Manage notification preferences</a></p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    const text = `
New SEC Filings Alert

You have ${filings.length} new filing${filings.length > 1 ? 's' : ''} from your watchlist:

${filings.map(f => `
${f.company}
Type: ${f.formType} - ${f.description}
Filed: ${new Date(f.filedDate).toLocaleDateString()}
View: ${this.getFilingUrl(f.accessionNumber, f.cik)}
`).join('\n---\n')}

Visit ${process.env.FRONTEND_URL} to see all your filings.
    `;

    return await this.sendEmail({
      to: user.email,
      subject,
      html,
      text
    });
  }

  // Send new filing alert SMS
  async sendFilingAlertSMS(phoneNumber, filings) {
    const filing = filings[0]; // Send info about first filing
    const count = filings.length;
    
    let message = `🔔 SEC Filing Alert: `;
    
    if (count === 1) {
      message += `${filing.company} filed ${filing.formType} (${filing.description})`;
    } else {
      message += `${count} new filings including ${filing.company} ${filing.formType}`;
    }
    
    message += `\nView: ${process.env.FRONTEND_URL}`;

    return await this.sendSMS({
      to: phoneNumber,
      message
    });
  }

  // Send digest email (daily/weekly summary)
  async sendDigestEmail(user, filings, period = 'daily') {
    const subject = `📊 Your ${period === 'daily' ? 'Daily' : 'Weekly'} SEC Filings Digest`;
    
    // Group filings by company
    const filingsByCompany = {};
    filings.forEach(filing => {
      if (!filingsByCompany[filing.company]) {
        filingsByCompany[filing.company] = [];
      }
      filingsByCompany[filing.company].push(filing);
    });

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #1e40af; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 20px; }
          .company-section { margin: 20px 0; }
          .company-name { font-size: 18px; font-weight: bold; color: #1f2937; margin-bottom: 10px; }
          .filing-item { background: white; padding: 10px; margin: 8px 0; border-left: 3px solid #3b82f6; border-radius: 4px; }
          .stats { background: white; padding: 15px; border-radius: 8px; margin: 20px 0; }
          .stat-item { display: inline-block; margin: 0 20px 10px 0; }
          .stat-number { font-size: 24px; font-weight: bold; color: #2563eb; }
          .stat-label { color: #6b7280; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0;">📊 ${period === 'daily' ? 'Daily' : 'Weekly'} Digest</h1>
            <p style="margin: 5px 0 0 0;">${new Date().toLocaleDateString()}</p>
          </div>
          <div class="content">
            <p>Hello ${user.name || 'there'},</p>
            
            <div class="stats">
              <div class="stat-item">
                <div class="stat-number">${filings.length}</div>
                <div class="stat-label">Total Filings</div>
              </div>
              <div class="stat-item">
                <div class="stat-number">${Object.keys(filingsByCompany).length}</div>
                <div class="stat-label">Companies</div>
              </div>
            </div>

            ${Object.entries(filingsByCompany).map(([company, companyFilings]) => `
              <div class="company-section">
                <div class="company-name">${company}</div>
                ${companyFilings.map(filing => `
                  <div class="filing-item">
                    <strong>${filing.formType}</strong> - ${filing.description}
                    <br>
                    <span style="color: #6b7280; font-size: 14px;">
                      ${new Date(filing.filedDate).toLocaleDateString()}
                    </span>
                  </div>
                `).join('')}
              </div>
            `).join('')}

            <p style="margin-top: 30px;">
              <a href="${process.env.FRONTEND_URL}" style="background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                View All Filings
              </a>
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    const text = `
${period === 'daily' ? 'Daily' : 'Weekly'} SEC Filings Digest
${new Date().toLocaleDateString()}

Summary:
- ${filings.length} total filings
- ${Object.keys(filingsByCompany).length} companies

${Object.entries(filingsByCompany).map(([company, companyFilings]) => `
${company}:
${companyFilings.map(f => `  • ${f.formType} - ${f.description} (${new Date(f.filedDate).toLocaleDateString()})`).join('\n')}
`).join('\n')}

View all filings: ${process.env.FRONTEND_URL}
    `;

    return await this.sendEmail({
      to: user.email,
      subject,
      html,
      text
    });
  }

  // Helper to get filing URL
  getFilingUrl(accessionNumber, cik) {
    const cleanAccession = accessionNumber.replace(/-/g, '');
    const paddedCik = String(cik).padStart(10, '0');
    return `https://www.sec.gov/cgi-bin/viewer?action=view&cik=${paddedCik}&accession_number=${accessionNumber}`;
  }

  // Send welcome email
  async sendWelcomeEmail(user) {
    const subject = 'Welcome to SEC Filings Tracker! 🎉';
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #2563eb; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 30px; }
          .button { background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 10px 0; }
          .feature { margin: 20px 0; padding: 15px; background: white; border-radius: 8px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0;">Welcome to SEC Filings Tracker! 🎉</h1>
          </div>
          <div class="content">
            <p>Hi ${user.name},</p>
            <p>Thanks for signing up! You're now ready to track SEC filings for any public company or insider.</p>
            
            <div class="feature">
              <h3>🔍 Get Started:</h3>
              <ol>
                <li>Add companies to your watchlist</li>
                <li>Set up notification preferences</li>
                <li>Receive instant alerts on new filings</li>
              </ol>
            </div>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.FRONTEND_URL}" class="button">Open Your Dashboard</a>
            </div>

            <p>Questions? Just reply to this email.</p>
            <p>Happy tracking!<br>The SEC Filings Tracker Team</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendEmail({
      to: user.email,
      subject,
      html,
      text: `Welcome to SEC Filings Tracker!\n\nThanks for signing up, ${user.name}!\n\nGet started at ${process.env.FRONTEND_URL}`
    });
  }

  // Test email configuration
  async testEmailConfig() {
    try {
      await this.emailTransporter.verify();
      console.log('✅ Email configuration is valid');
      return true;
    } catch (error) {
      console.error('❌ Email configuration error:', error);
      return false;
    }
  }
}

module.exports = new NotificationService();