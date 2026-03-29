# How to Get a Permanent WhatsApp Access Token

To obtain a permanent access token for the WhatsApp Business API, you must create a **System User** within your Meta Business Manager account.

### Step-by-Step Instructions

1.  **Access Business Settings**
    *   Go to [Meta Business Suite](https://business.facebook.com/).
    *   Navigate to **Business Settings** (gear icon in the sidebar).

2.  **Create a System User**
    *   In the sidebar, go to **Users > System users**.
    *   Click **Add**.
    *   Enter a name (e.g., "WhatsApp_Bot").
    *   Select **Admin** as the role and click **Create System User**.

3.  **Assign Assets**
    *   Select the new system user.
    *   Click **Add Assets**.
    *   **Apps:** Select your WhatsApp App and toggle **Full control** (Manage app) ON.
    *   **WhatsApp Accounts:** Ensure the user has access to the relevant WhatsApp Business Account (WABA).

4.  **Generate the Token**
    *   Click **Generate New Token**.
    *   Select your app from the dropdown.
    *   Check these permissions:
        *   `whatsapp_business_messaging`
        *   `whatsapp_business_management`
    *   Click **Generate Token**.

5.  **Save Securely**
    *   **Copy the token immediately.** Meta will only show it once.
    *   Paste it into your `.env` file as `WHATSAPP_ACCESS_TOKEN`.

> [!CAUTION]
> Treat this token as a password. Never commit your `.env` file to a public repository.
