export function buildSignInEmail(signInLink: string, _email: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign in to Mocktail</title>
</head>
<body style="margin:0;padding:0;background-color:#0b0d10;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#0b0d10;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;">
          <tr>
            <td align="center" style="padding:32px 0 24px 0;">
              <span style="font-size:22px;font-weight:700;letter-spacing:0.08em;color:#e6edf5;">MOCKTAIL</span>
            </td>
          </tr>
          <tr>
            <td>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#12151a;border:1px solid #20262e;border-radius:10px;">
                <tr>
                  <td style="padding:40px 40px 32px 40px;">
                    <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:600;color:#e6edf5;">Sign in to Mocktail</h1>
                    <p style="margin:0 0 28px 0;font-size:15px;line-height:1.6;color:#c6cdd6;">
                      Click the button below to sign in. This link expires in 1 hour.
                    </p>
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td align="center" style="padding:0 0 28px 0;">
                          <a href="${signInLink}" target="_blank" style="display:inline-block;background-color:#4f8cff;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:6px;line-height:1;">Sign in to Mocktail</a>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:0 0 8px 0;font-size:13px;line-height:1.5;color:#8a95a4;">
                      If the button doesn't work, copy and paste this link:
                    </p>
                    <p style="margin:0 0 28px 0;font-size:13px;line-height:1.5;word-break:break-all;">
                      <a href="${signInLink}" style="color:#4f8cff;text-decoration:underline;">${signInLink}</a>
                    </p>
                    <p style="margin:0;font-size:13px;line-height:1.5;color:#8a95a4;">
                      If you didn't request this email, you can safely ignore it.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
