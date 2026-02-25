# Gmail Contact Graph

A tool to visualize your Gmail communication patterns. Parse your Gmail export, extract contacts with spam filtering and AI verification, and explore your email network through an interactive web interface.

## Features

- **High-performance parsing** - Rust-based MBOX parser for fast processing of large email archives
- **Smart contact filtering** - Multi-stage filtering: basic spam detection + AI-powered human verification
- **Interactive visualization** - D3.js force-directed graph showing your email network
- **Composite ranking** - Score contacts based on communication frequency and patterns
- **Domain grouping** - View contacts grouped by organization (email domain)

## Quick Start

```bash
git clone https://github.com/YOUR_USERNAME/gmail-contact-graph.git
cd gmail-contact-graph
make setup
# Place your .mbox file in data/ directory
make fill-db USER_EMAIL=your.email@gmail.com
make run
# Open http://localhost:5000
```

## Prerequisites

- **Python 3.8+**
- **Rust** (for building the parser)
- **Make** (available on Linux/macOS, use `choco install make` on Windows)
- **Gmail data export** (.mbox file from Google Takeout)
- **Hugging Face API key** (optional, for AI contact verification)

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/gmail-contact-graph.git
cd gmail-contact-graph
```

### 2. Run setup

```bash
make setup
```

This will:
- Create a Python virtual environment
- Install Python dependencies
- Build the Rust parser and tools

### 3. Activate the virtual environment

```bash
# Windows
venv\Scripts\activate

# Linux/macOS
source venv/bin/activate
```

## Getting Your Gmail Data

1. Go to [Google Takeout](https://takeout.google.com/)
2. Click "Deselect all"
3. Find and select only "Mail"
4. Click "All Mail data included" and choose the labels you want (or keep all)
5. Select MBOX format
6. Click "Next step" and create the export
7. Download and extract the archive
8. Find the `.mbox` file (usually named `All mail Including Spam and Trash.mbox`)

## Configuration

### 1. Update config.py

Edit `src/config.py` with your email and name:

```python
MY_EMAIL = "your.email@gmail.com"
MY_NAME = "Your Name"
```

### 2. Set up environment variables (optional)

Create a `.env` file in the project root for AI verification:

```env
HF_API_KEY=your_huggingface_api_key
HF_MODEL=meta-llama/Llama-3.1-8B-Instruct
HF_BATCH_SIZE=50
HF_TIMEOUT=120
```

Without the API key, contacts will still be filtered but marked as "unclear".

## Usage

### Step 1: Parse your Gmail data

Place your `.mbox` file in the `data/` directory (or specify a custom path), then run:

```bash
make fill-db USER_EMAIL=your.email@gmail.com
```

Or with a custom mbox path:

```bash
make fill-db USER_EMAIL=your.email@gmail.com MBOX_FILE=path/to/mail.mbox
```

This will:
1. Parse the MBOX file and create `data/mails.db`
2. Extract contacts and create `data/contacts.db`
3. Apply spam filtering to create candidate contacts
4. Run AI verification (if HF_API_KEY is set) to filter humans

### Step 2: Run the web interface

```bash
make run
```

Open http://localhost:5000 in your browser.

### Additional commands

```bash
make help           # Show all available commands
make rankings       # Generate ranking files
make process-all    # Run fill-db + rankings
make clean-db       # Remove databases and start fresh
```

## Project Structure

```
gmail-contact-graph/
├── data/                    # Generated databases (gitignored)
│   ├── mails.db            # Email messages
│   └── contacts.db         # Contacts with statistics
├── rust_parser/            # High-performance Rust parser
│   └── src/
│       └── bin/
│           └── fill_db/    # Main parsing pipeline with AI verification
├── src/                    # Python utilities
│   ├── config.py          # Project configuration
│   ├── models.py          # Data models
│   └── parser.py          # Contact loading utilities
├── webapp/                 # Flask web application
│   ├── app.py             # Flask routes and API
│   ├── static/            # CSS and JavaScript
│   └── templates/         # HTML templates
├── requirements.txt
└── README.md
```

## API Endpoints

The webapp provides these REST API endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/graph` | GET | Graph data for D3.js visualization |
| `/api/contacts` | GET | List of all contacts |
| `/api/domains` | GET | Contacts grouped by email domain |
| `/api/message-groups` | GET | Multi-recipient emails grouped by subject |
| `/api/excluded-contacts` | GET | Contacts filtered out as spam/non-human |
| `/api/contacts/mark-clear` | POST | Mark a contact as definitely human |
| `/api/contacts/mark-not-human` | POST | Remove a contact (mark as non-human) |

## How It Works

### Contact Filtering Pipeline

1. **Basic spam filter** - Removes obvious automated/system emails based on patterns in email addresses and names
2. **AI verification** - Uses Hugging Face LLM to classify contacts as human/not-human based on name and email patterns
3. **Manual review** - Web interface allows marking uncertain contacts as clear or removing them

### Composite Scoring

Contacts are ranked using a weighted scoring system:
- **Sent emails** - Coefficient: 1.0 (emails you sent to this contact)
- **Received emails** - Coefficient: 0.2 (emails received from this contact)

Higher scores indicate more important contacts in your network.

## Troubleshooting

### Parser fails with memory error
- Your MBOX file might be very large. The parser uses memory-efficient streaming, but very large files (>10GB) may need more RAM.

### No contacts appear
- Verify your email is correctly set in `src/config.py`
- Check that the MBOX file path is correct
- Look at the parser output for error messages

### AI verification not working
- Ensure `HF_API_KEY` is set in your `.env` file
- Check that you have access to the specified model on Hugging Face
- Without AI verification, all candidates are added with `not_clear=true`

## Privacy Note

This tool processes your email data locally. No data is sent to external servers except:
- AI verification requests to Hugging Face (only contact names and emails, not message content)

Your MBOX file and generated databases are stored locally and gitignored.

## License

MIT
