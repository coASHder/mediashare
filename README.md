# 📸 Media Share

A simple image-sharing web app built with Node.js, Express, and MongoDB.

## Project Structure

```
mediashare/
├── server.js           ← Express backend + API routes
├── package.json
├── .env.example        ← Copy to .env and set your MongoDB URI
├── uploads/            ← Uploaded image files are stored here
└── public/
    ├── index.html      ← Home / gallery page
    ├── upload.html     ← Upload form page
    ├── detail.html     ← Image detail page
    └── css/
        └── style.css
```

## Requirements

- [Node.js](https://nodejs.org/) v16 or newer
- [MongoDB](https://www.mongodb.com/) — either:
  - **Local**: Install MongoDB Community Edition and run `mongod`
  - **Cloud**: Free cluster at [MongoDB Atlas](https://www.mongodb.com/atlas)

---

## Option A — Local MongoDB

### 1. Install MongoDB Community Edition
Download from: https://www.mongodb.com/try/download/community

### 2. Start MongoDB
```bash
# Windows (run in a separate terminal)
mongod --dbpath C:\data\db

# Mac/Linux
mongod --dbpath ./data
```

### 3. Install & run the app
```bash
cd mediashare
npm install
npm start
```

Open **http://localhost:3000**

---

## Option B — MongoDB Atlas (Cloud, free)

### 1. Create a free cluster
- Go to https://www.mongodb.com/atlas
- Create a free account → Build a free M0 cluster
- Under **Database Access**: create a user with a password
- Under **Network Access**: add `0.0.0.0/0` (allow all IPs)
- Click **Connect** → **Drivers** → copy the connection string

### 2. Set your connection string
Create a `.env` file in the project root:
```
MONGO_URI=mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/mediashare
```

### 3. Install dotenv and run
```bash
npm install dotenv
```

Add this line to the very top of `server.js`:
```js
require('dotenv').config();
```

Then:
```bash
npm start
```

---

## What's stored in MongoDB

Each uploaded image creates one document in the `mediashare.images` collection:

```json
{
  "_id": "ObjectId(...)",
  "title": "Sunset at the beach",
  "location": "Malibu, CA",
  "datetime": "2026-03-10T18:30",
  "genre": "Landscape",
  "description": "Golden hour on the Pacific coast.",
  "filepath": "/uploads/1741869123-847362910.jpg",
  "createdAt": "2026-03-13T12:00:00.000Z"
}
```

Image **files** are stored in the `uploads/` folder on disk.
