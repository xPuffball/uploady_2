# DigitalOcean Folder Uploader

A minimalistic web application for uploading large folders (up to 1TB) to DigitalOcean Spaces.

## Features

- Drag-and-drop folder uploads
- Preserves folder structure in DigitalOcean Spaces
- Handles multipart uploads automatically
- Reliable uploads with retries and chunk management
- Progress tracking for each file
- Concurrent uploads for better performance
- Supports large files (tested with files up to 1TB)

## Technologies Used

- **Backend**: Python, Flask, boto3
- **Frontend**: HTML, CSS, JavaScript (Vanilla)
- **Upload System**: DigitalOcean Spaces (S3-compatible)

## Setup

### Prerequisites

- Python 3.7+
- DigitalOcean Spaces account with access key and secret
- A bucket created in DigitalOcean Spaces

### Installation

1. Clone this repository

2. Install dependencies
```bash
pip install -r requirements.txt
```

3. Configure the environment variables by creating a `.env` file:
```
DO_SPACES_KEY=your_access_key
DO_SPACES_SECRET=your_secret_key
DO_SPACES_REGION=nyc3
DO_SPACES_ENDPOINT=https://nyc3.digitaloceanspaces.com
DO_SPACES_BUCKET=your_bucket_name
```

### Running the Application

Start the server:
```bash
python app.py
```

The application will be available at http://localhost:5000

## How It Works

### Backend

- Flask serves as a lightweight API server
- Files are received by the Flask endpoint
- boto3 (AWS SDK for Python) handles multipart uploads
- TransferConfig is configured for optimal upload settings:
  - Files over 25MB trigger multipart uploads
  - Each chunk is 25MB
  - Up to 10 concurrent threads for parts
  - 5 automatic retries for failed parts

### Frontend

- Web interface with drag-and-drop folder support
- Files are processed recursively to maintain folder structure
- Progress tracking with XHR upload events
- Queue system to limit concurrent uploads
- UI feedback for upload status

## Upload Flow

1. User selects or drops a folder in the UI
2. Frontend recursively processes the folder structure
3. Files are queued for upload with a concurrency limit
4. For each file:
   - File is sent to the backend with its relative path
   - Backend saves it temporarily and initiates a multipart upload
   - Upload progress is tracked and displayed
   - On completion, temporary files are cleaned up
5. Upload summary is displayed with success/failure counts

## Customization

You can adjust these parameters in `app.py`:

- `multipart_threshold`: Size threshold for multipart uploads (default: 25MB)
- `multipart_chunksize`: Size of each part (default: 25MB)
- `max_concurrency`: Number of concurrent threads (default: 10)
- `retries`: Number of automatic retries (default: 5)

You can adjust these parameters in `static/app.js`:

- `MAX_CONCURRENT_UPLOADS`: Number of files to upload simultaneously (default: 3)

## License

MIT 