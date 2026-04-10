# Instagram Coupon Bot

A webhook-based Instagram bot that automatically assigns unique coupons to users who message specific keywords and logs all interactions to a Google Sheet.

## Features

- **Webhook Integration**: Receives messages from Instagram DM.
- **Coupon Assignment**: Assigns a unique coupon code from a Google Sheet.
- **Rate Limiting**: Prevents users from getting multiple coupons too quickly.
- **Logging**: Logs all messages and coupon assignments to a Google Sheet.
- **Existing Coupon Check**: Prevents users from getting more than one coupon.

## Prerequisites

- Node.js installed.
- A Facebook Developer App with **Instagram Messaging** enabled.
- A Facebook Page connected to the Instagram App.
- A Google Sheet with the following structure:
  - **Sheet1**: Coupon codes and their status.
    - Column A: Coupon Code
    - Column B: Status (Available, Assigned, Used)
    - Column C: User ID (assigned to)
  - **Sheet2**: Message logs.
    - Column A: Timestamp
    - Column B: User ID
    - Column C: Username
    - Column D: Message

## Setup

1.  **Install Dependencies**:
    ```bash
    npm install express axios dotenv googleapis
    ```

2.  **Configure Environment Variables**:
    Create a `.env` file in the root directory with the following variables:

    ```env
    VERIFY_TOKEN=your_verify_token
    PAGE_ACCESS_TOKEN=your_page_access_token
    PORT=3000
    IG_USER_ID=your_instagram_user_id
    SPREADSHEET_ID=your_google_sheet_id
    ```

3.  **Google Sheets Credentials**:
    - Create a Google Cloud Project and enable the Google Sheets API.
    - Create a Service Account and download the credentials JSON file.
    - Rename the file to `credentials.json` and place it in the root directory.
    - Share your Google Sheet with the service account email address.

4.  **Configure Webhook**:
    - Go to your Facebook App Dashboard -> **Messenger** -> **Webhooks**.
    - Click **Edit Callback URL**.
    - **Callback URL**: `https://your-domain.com/webhook` (or your ngrok URL).
    - **Verify Token**: `your_verify_token` (must match `VERIFY_TOKEN` in `.env`).
    - **Subscription Fields**: Select `messages` and `messaging_postbacks`.

## Running the Server

```bash
node index.js
```

The server will start on port 3000 (or as specified in `.env`).

## Usage

Users can message the connected Instagram account with any of the following keywords to receive a coupon:

- `coupon`
- `#freeicecream`
- `#frozellecreamery`

### Example Flow

1.  User messages: `I want a coupon`
2.  Bot checks if user already has a coupon.
3.  If not, bot assigns the next available coupon from `Sheet1`.
4.  Bot sends a message back with the coupon code.
5.  Bot logs the interaction to `Sheet2`.
