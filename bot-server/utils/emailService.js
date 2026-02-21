// utils/emailService.js
const nodemailer = require("nodemailer");

// Create transporter based on environment
const createTransporter = () => {
  // Use environment variables for SMTP configuration
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.warn("⚠️ Email service not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS environment variables.");
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true for 465, false for other ports
    auth: {
      user,
      pass
    }
  });
};

let transporter = null;

// Initialize transporter lazily
const getTransporter = () => {
  if (!transporter) {
    transporter = createTransporter();
  }
  return transporter;
};

/**
 * Send password reset email
 * @param {string} email - Recipient email
 * @param {string} resetUrl - Password reset URL with token
 * @param {string} firstName - User's first name
 */
const sendPasswordResetEmail = async (email, resetUrl, firstName) => {
  const transport = getTransporter();

  if (!transport) {
    console.error("❌ Cannot send email: Email service not configured");
    throw new Error("Email service not configured");
  }

  const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
  const appName = "Hanlob Dashboard";

  const mailOptions = {
    from: `"${appName}" <${fromEmail}>`,
    to: email,
    subject: "Recuperar contraseña - Hanlob Dashboard",
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Recuperar contraseña</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #1a1a2e;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1a1a2e; padding: 40px 20px;">
          <tr>
            <td align="center">
              <table width="600" cellpadding="0" cellspacing="0" style="background-color: #16213e; border-radius: 12px; overflow: hidden;">
                <!-- Header -->
                <tr>
                  <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
                    <div style="width: 60px; height: 60px; background-color: rgba(255,255,255,0.2); border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 15px;">
                      <span style="color: white; font-size: 32px; font-weight: bold;">H</span>
                    </div>
                    <h1 style="color: white; margin: 0; font-size: 24px;">Hanlob Dashboard</h1>
                  </td>
                </tr>

                <!-- Content -->
                <tr>
                  <td style="padding: 40px 30px;">
                    <h2 style="color: white; margin: 0 0 20px 0; font-size: 20px;">
                      Hola ${firstName || ""},
                    </h2>
                    <p style="color: #a0a0a0; font-size: 16px; line-height: 1.6; margin: 0 0 25px 0;">
                      Recibimos una solicitud para restablecer la contraseña de tu cuenta.
                      Haz clic en el botón de abajo para crear una nueva contraseña.
                    </p>

                    <!-- Button -->
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td align="center" style="padding: 20px 0;">
                          <a href="${resetUrl}"
                             style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                                    color: white; text-decoration: none; padding: 14px 40px;
                                    border-radius: 8px; font-size: 16px; font-weight: bold;">
                            Restablecer contraseña
                          </a>
                        </td>
                      </tr>
                    </table>

                    <p style="color: #a0a0a0; font-size: 14px; line-height: 1.6; margin: 25px 0 0 0;">
                      Este enlace expirará en <strong style="color: white;">1 hora</strong>.
                    </p>
                    <p style="color: #a0a0a0; font-size: 14px; line-height: 1.6; margin: 15px 0 0 0;">
                      Si no solicitaste restablecer tu contraseña, puedes ignorar este correo.
                      Tu contraseña actual seguirá siendo la misma.
                    </p>

                    <!-- URL fallback -->
                    <div style="margin-top: 30px; padding: 15px; background-color: #0f1629; border-radius: 8px;">
                      <p style="color: #666; font-size: 12px; margin: 0 0 8px 0;">
                        Si el botón no funciona, copia y pega este enlace en tu navegador:
                      </p>
                      <p style="color: #667eea; font-size: 12px; margin: 0; word-break: break-all;">
                        ${resetUrl}
                      </p>
                    </div>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="padding: 20px 30px; border-top: 1px solid #2a2a4a; text-align: center;">
                    <p style="color: #666; font-size: 12px; margin: 0;">
                      © ${new Date().getFullYear()} Hanlob. Todos los derechos reservados.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
    text: `
Hola ${firstName || ""},

Recibimos una solicitud para restablecer la contraseña de tu cuenta en Hanlob Dashboard.

Para crear una nueva contraseña, visita el siguiente enlace:
${resetUrl}

Este enlace expirará en 1 hora.

Si no solicitaste restablecer tu contraseña, puedes ignorar este correo.

- Equipo Hanlob
    `
  };

  try {
    const info = await transport.sendMail(mailOptions);
    console.log(`✅ Password reset email sent to ${email} (Message ID: ${info.messageId})`);
    return info;
  } catch (error) {
    console.error(`❌ Failed to send password reset email to ${email}:`, error.message);
    throw error;
  }
};

/**
 * Test email configuration
 */
const testEmailConfig = async () => {
  const transport = getTransporter();

  if (!transport) {
    return { success: false, error: "Email service not configured" };
  }

  try {
    await transport.verify();
    return { success: true, message: "Email configuration is valid" };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

/**
 * Send a plain alert email (for system health notifications)
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} body - Plain text body
 */
const sendAlertEmail = async (to, subject, body) => {
  const transport = getTransporter();
  if (!transport) {
    console.error("❌ Cannot send alert email: Email service not configured");
    return;
  }

  const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;

  try {
    await transport.sendMail({
      from: `"Hanlob Alert" <${fromEmail}>`,
      to,
      subject,
      text: body
    });
    console.log(`📧 Alert email sent to ${to}: ${subject}`);
  } catch (error) {
    console.error(`❌ Failed to send alert email:`, error.message);
  }
};

module.exports = {
  sendPasswordResetEmail,
  testEmailConfig,
  sendAlertEmail
};
