# Gmail Contact Graph

Interactive web visualization of your Gmail communication network. Explore contacts through a D3.js force-directed graph.

## Features

- Interactive D3.js force-directed graph visualization
- Contact search and filtering
- Domain grouping (see contacts by organization)
- Composite ranking based on email frequency
- Manual contact review (mark as human/not human)

## Prerequisites

- Python 3.8+
- Databases from [gmail-mbox-parser](https://github.com/YOUR_USERNAME/gmail-mbox-parser)

## Installation

```bash
git clone https://github.com/YOUR_USERNAME/gmail-contact-graph.git
cd gmail-contact-graph
make setup
```

## Usage

### 1. Generate data with gmail-mbox-parser

First, use the parser to create the databases:

```bash
# In gmail-mbox-parser repo
DATA_DIR=~/gmail-data make fill-db USER_EMAIL=you@gmail.com MBOX_FILE=~/mail.mbox
```

### 2. Run the webapp

```bash
# Point to the same data directory
DATA_DIR=~/gmail-data MY_EMAIL=you@gmail.com MY_NAME="Your Name" make run
```

Open http://localhost:5000

## Configuration

Set via environment variables or `.env` file:

```env
DATA_DIR=~/gmail-data
MY_EMAIL=your.email@gmail.com
MY_NAME=Your Name
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/graph` | GET | Graph data for D3.js |
| `/api/contacts` | GET | All contacts |
| `/api/domains` | GET | Contacts grouped by domain |
| `/api/message-groups` | GET | Multi-recipient emails |
| `/api/excluded-contacts` | GET | Filtered spam/non-human |
| `/api/contacts/mark-clear` | POST | Mark contact as human |
| `/api/contacts/mark-not-human` | POST | Remove contact |

## Commands

```
make setup          Create virtual environment
make run            Start web application
make run-dev        Start in development mode
make clean          Remove venv and cache
make help           Show all commands
```
