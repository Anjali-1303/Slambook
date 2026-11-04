# Digital Slam Book

A web-based digital autograph & slam book application built for collecting memories from friends and classmates. Designed with a public entry submission form and a password-protected owner dashboard so secret messages remain private.

---

## Features

- **Public Autograph Form**: Friends can write personal memories, answer fun questions, and leave a paragraph.
- **Secret Messages**: Supports optional secret messages with anonymous sender options.
- **Strict Privacy**: Visitors can submit memories, but cannot view anyone else's submissions or secrets.
- **Protected Owner Dashboard**: Access to entries (`/admin.html`) is secured with an Admin Passcode.
- **Google Drive Backup**: Every submission is mirrored automatically into a private Google Sheet, with selfies saved to a private Drive folder. Failures are retried in the background.
- **Dashboard Tools**: Search/filter entries by name or text, and delete unwanted entries.

---

## Tech Stack

- **Backend**: Node.js & Express
- **Database**: MongoDB Atlas (`mongoose`) - source of truth
- **Backup**: Google Sheets + Google Drive via a Google Apps Script webhook
- **Frontend**: HTML5, CSS3, Vanilla JavaScript (Fetch API)

---

## Project Structure

```
digital-slam-book/
├── public/
│   ├── index.html              # Public submission form
│   └── admin.html              # Password-protected owner dashboard
├── models/
│   └── entry.js                # Shared Mongoose model (server + export)
├── drive-backup.js             # Sends each entry to the Drive webhook
├── google-drive-backup.gs      # Paste this into Google Apps Script
├── server.js                   # Express server & API endpoints
├── export.js                   # Offline export from MongoDB to printable HTML
├── .env.example                # Copy to .env and fill in
├── package.json
└── README.md
```

---

## Quick Start (Local Setup)

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment**
   ```bash
   copy .env.example .env
   ```
   Then edit `.env` and set at least `MONGODB_URI` and `ADMIN_PASSWORD`.

3. **Start the server**
   ```bash
   npm start
   ```

4. **Open in browser**
   - **Public Autograph Page**: `http://localhost:3000`
   - **Owner Dashboard**: `http://localhost:3000/admin.html`

> The npm scripts use `node --env-file-if-exists=.env`, so a missing `.env` is not an error - the app falls back to real environment variables.

---

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `MONGODB_URI` | Yes (prod) | MongoDB Atlas connection string. Falls back to `mongodb://localhost:27017/slambook`. |
| `ADMIN_PASSWORD` | **Yes** | Dashboard passcode. Never ship the default `anjali123`. |
| `DRIVE_WEBHOOK_URL` | No | Apps Script Web App URL ending in `/exec`. Leave blank to disable Drive backup. |
| `DRIVE_SHARED_SECRET` | With above | Must match `SHARED_SECRET` in `google-drive-backup.gs`. |
| `PORT` | No | Set automatically by Render. |

---

## Google Drive Backup Setup

1. Create a Google Sheet called **Slam Book Responses**.
2. In that Sheet open **Extensions > Apps Script**, delete the sample code, and paste the contents of `google-drive-backup.gs`.
3. Create a Drive folder called **Slam Book Selfies** and paste its folder ID into `SELFIE_FOLDER_ID`.
4. Set `SHARED_SECRET` in the script to a long random string.
5. **Deploy > New deployment > Web app**, with *Execute as: Me* and *Who has access: Anyone*. Authorize when prompted.
6. Copy the Web App URL into `DRIVE_WEBHOOK_URL`, and the same secret into `DRIVE_SHARED_SECRET`.
7. Run `setupSheet()` once in the Apps Script editor to create the header row.

Every submission is appended as a row, and the selfie is saved as a file in the private folder. Retries are de-duplicated by entry ID, so network hiccups never create duplicates. Entries created before backup was enabled are backfilled automatically after deploy.

**Reading entries:** you can simply open the Google Sheet. The `/admin.html` dashboard still works and reads from MongoDB.

---

## Offline Export

Generate a single printable HTML book from MongoDB:

```bash
npm run export
```

This writes `SlamBook_All_Entries.html` next to the project. It contains full personal data, so it is gitignored - keep that file private.

---

## Online Deployment (Free Hosting)

### Render
1. Push this project folder to GitHub.
2. On [Render.com](https://render.com) click **New Web Service** and select the repository.
3. **Build Command**: `npm install`
4. **Start Command**: `npm start`
5. Add environment variables:
   - `MONGODB_URI` = your MongoDB Atlas connection string
   - `ADMIN_PASSWORD` = `your_chosen_secret_password`
   - `DRIVE_WEBHOOK_URL` and `DRIVE_SHARED_SECRET` (optional)
6. Click **Deploy**.

For MongoDB, create a free **M0** cluster on [MongoDB Atlas](https://www.mongodb.com/atlas), allow access from `0.0.0.0/0` (Render has no fixed IP), and create a database user.

Live check: https://digital-slam-book-3m8t.onrender.com/

---
