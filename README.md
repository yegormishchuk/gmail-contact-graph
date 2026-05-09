# Gmail Contact Graph

Visualize your Gmail communication network as an interactive graph. Parse your Gmail export, extract contacts, and explore them through a D3.js force-directed web interface.

## Dependencies

- **Rust 1.70+** — for the mbox parser
- **Node.js 18+** — for the webapp

## Step-by-step setup

### 1. Download your Gmail data

Go to [Google Takeout](https://takeout.google.com), select **Mail**, and export. You'll get a `.mbox` file.

### 2. Place the mbox file in the data directory

Place the mbox file in the data directory. 

If your file has a different name, you can pass it explicitly in the next step. (default filename used is data.mbox)

### 3. Parse the mbox and generate databases + rankings

```bash
cd gmail-mbox-parser
make process-all USER_EMAIL=you@gmail.com
```

If your mbox file has a different name than `data.mbox`:

```bash
make process-all USER_EMAIL=you@gmail.com MBOX_FILE=your-export.mbox
```

This runs both `fill-db` (parses the mbox into SQLite databases) and `rankings` (generates contact ranking files). All output goes to `../data/`.

#### Optional: AI-powered spam filtering via Hugging Face

Copy the project-root template and fill in your token:

```bash
cp .env.example .env
```

```env
HF_API_KEY=your_huggingface_api_key
HF_MODEL=meta-llama/Llama-3.1-8B-Instruct
```

The same `.env` is also used to set `USER_EMAIL` (so you can drop the
`USER_EMAIL=...` argument from the make commands above) and the webapp's
`USER_NAME` display value.

### 4. Install webapp dependencies

```bash
cd ../gmail-contact-graph
make install
```

### 5. Build and run the webapp

```bash
make build
make run
```

Or combine install + build in one step:

```bash
make setup
make run
```

Open [http://localhost:5000](http://localhost:5000).

---

## Output files (in `data/`)

| File | Description |
|---|---|
| `contacts.db` | Extracted contacts with spam filtering |
| `mails.db` | Parsed email metadata |
| `sent_ranking.txt` | Contacts ranked by emails sent |
| `received_ranking.txt` | Contacts ranked by emails received |
| `sent_per_month_ranking.txt` | Sent emails normalized by relationship duration |
| `received_per_month_ranking.txt` | Received emails normalized by relationship duration |
| `duration_ranking.txt` | Contacts ranked by communication duration |
| `email_length_ranking.txt` | Contacts ranked by average email length |
| `composite_ranking.txt` | Combined score ranking (sent × 1.0 + received × 0.2) |

## Quick reference

| Directory | Command | Description |
|---|---|---|
| `gmail-mbox-parser/` | `make process-all USER_EMAIL=...` | Parse mbox + generate rankings |
| `gmail-mbox-parser/` | `make fill-db USER_EMAIL=...` | Parse mbox only |
| `gmail-mbox-parser/` | `make rankings` | Generate rankings only |
| `gmail-contact-graph/` | `make setup` | Install deps + build |
| `gmail-contact-graph/` | `make run` | Start production server (port 5000) |
| `gmail-contact-graph/` | `make dev` | Start dev servers (API:5000, Client:3000) |
