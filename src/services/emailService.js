'use strict';

const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  }
  return transporter;
}

async function sendOtpEmail(toEmail, otp, recipientName) {
  const mailOptions = {
    from: `"ICICI RideShare Bot" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: 'Your ICICI RideShare Verification OTP',
    text: `Hi ${recipientName},\n\nYour OTP for ICICI RideShare is: ${otp}\n\nThis OTP is valid for 10 minutes. Do not share it with anyone.\n\nTeam ICICI RideShare`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <div style="background-color: #003366; padding: 16px; border-radius: 6px 6px 0 0; text-align: center;">
          <h2 style="color: #ffffff; margin: 0;">🚗 ICICI RideShare</h2>
        </div>
        <div style="padding: 24px; background: #ffffff;">
          <p style="color: #333; font-size: 16px;">Hi <strong>${recipientName}</strong>,</p>
          <p style="color: #333; font-size: 15px;">Your verification OTP is:</p>
          <div style="text-align: center; margin: 24px 0;">
            <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #003366;">${otp}</span>
          </div>
          <p style="color: #666; font-size: 13px;">⏱️ This OTP expires in <strong>10 minutes</strong>.</p>
          <p style="color: #666; font-size: 13px;">🔒 Do not share this OTP with anyone.</p>
        </div>
        <div style="background: #f5f5f5; padding: 12px; text-align: center; border-radius: 0 0 6px 6px;">
          <p style="color: #999; font-size: 12px; margin: 0;">ICICI RideShare — For ICICI Bank employees, Hyderabad</p>
        </div>
      </div>
    `,
  };

  try {
    await getTransporter().sendMail(mailOptions);
    console.log(`[Email] OTP sent to ${toEmail}`);
    return { success: true };
  } catch (err) {
    console.error('[Email] Failed to send OTP:', err.message);
    return { success: false, error: err.message };
  }
}

async function verifyConnection() {
  try {
    await getTransporter().verify();
    console.log('[Email] SMTP connection verified.');
    return true;
  } catch (err) {
    console.warn('[Email] SMTP verification failed:', err.message);
    return false;
  }
}

module.exports = { sendOtpEmail, verifyConnection };
