import os
import tempfile
from flask import Flask, request, jsonify, send_from_directory, redirect, url_for, session, render_template
from flask_cors import CORS
import boto3
from boto3.s3.transfer import TransferConfig
import logging
from dotenv import load_dotenv
import uuid
import time
import random
import botocore.exceptions
import secrets

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO, 
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Custom temp directory - set this to a drive with plenty of space
# If not set, system default temp directory will be used
TEMP_DIR = os.getenv('UPLOAD_TEMP_DIR', None)
if TEMP_DIR and os.path.exists(TEMP_DIR):
    logger.info(f"Using custom temp directory: {TEMP_DIR}")
    tempfile.tempdir = TEMP_DIR
else:
    logger.info(f"Using system default temp directory: {tempfile.gettempdir()}")

# Create Flask app with static files from the static directory
app = Flask(__name__, 
            static_url_path='', 
            static_folder='static')
CORS(app)

# Configure Flask to handle terabyte-scale uploads
app.config['MAX_CONTENT_LENGTH'] = 1024 * 1024 * 1024 * 1024  # 1TB max file size
app.config['UPLOAD_FOLDER'] = tempfile.gettempdir()

# Set a secret key for session management
app.secret_key = os.getenv('SECRET_KEY', secrets.token_hex(16))

# Set password for accessing the app
APP_PASSWORD = os.getenv('APP_PASSWORD', 'upload123')  # Default password if not set in .env

# DigitalOcean Spaces credentials
SPACES_KEY = os.getenv('DO_SPACES_KEY')
SPACES_SECRET = os.getenv('DO_SPACES_SECRET')
SPACES_REGION = os.getenv('DO_SPACES_REGION', 'nyc3')
SPACES_ENDPOINT = os.getenv('DO_SPACES_ENDPOINT', f'https://{SPACES_REGION}.digitaloceanspaces.com')
SPACES_BUCKET = os.getenv('DO_SPACES_BUCKET')

# Configure S3 client with increased retries and timeouts
s3_config = boto3.session.Config(
    retries={
        'max_attempts': 10,  # Increased from 5 to 10
        'mode': 'adaptive',  # Changed from 'standard' to 'adaptive'
    },
    connect_timeout=86400,     # 24 hours - ridiculously long to never hit
    read_timeout=86400,        # 24 hours - ridiculously long to never hit
    max_pool_connections=30    # Increased from default 10
)

# Create a transfer config with increased timeouts for larger files
transfer_config = TransferConfig(
    multipart_threshold=100 * 1024 * 1024,  # 100MB - increased for terabyte files
    max_concurrency=20,  # Increased concurrency
    multipart_chunksize=100 * 1024 * 1024,  # 100MB chunks - increased for terabyte files
    use_threads=True,
    max_io_queue=200,  # Increased queue size
    io_chunksize=524288  # 512KB chunks for reading - increased for better throughput
)

# Determine if we should use acceleration endpoint
USE_ACCELERATION = os.getenv('USE_ACCELERATION', 'True').lower() in ('true', 'yes', '1')

# Set the endpoint based on acceleration setting
if USE_ACCELERATION:
    endpoint_url = f'https://{SPACES_BUCKET}.s3-accelerate.amazonaws.com'
    logger.info(f"Using S3 Transfer Acceleration endpoint: {endpoint_url}")
else:
    endpoint_url = SPACES_ENDPOINT
    logger.info(f"Using standard S3 endpoint: {endpoint_url}")

# Create S3 client
s3 = boto3.client('s3',
                  region_name=SPACES_REGION,
                  endpoint_url=endpoint_url,
                  aws_access_key_id=SPACES_KEY,
                  aws_secret_access_key=SPACES_SECRET,
                  config=s3_config)

# Enable transfer acceleration on the bucket if needed
if USE_ACCELERATION:
    try:
        logger.info(f"Checking Transfer Acceleration status for bucket: {SPACES_BUCKET}")
        acceleration_status = s3.get_bucket_accelerate_configuration(Bucket=SPACES_BUCKET)
        current_status = acceleration_status.get('Status', 'None')
        
        if current_status != 'Enabled':
            logger.info(f"Enabling Transfer Acceleration for bucket: {SPACES_BUCKET}")
            s3.put_bucket_accelerate_configuration(
                Bucket=SPACES_BUCKET,
                AccelerateConfiguration={'Status': 'Enabled'}
            )
            logger.info("Transfer Acceleration enabled successfully")
        else:
            logger.info("Transfer Acceleration already enabled")
    except Exception as e:
        logger.warning(f"Could not enable Transfer Acceleration: {str(e)}")
        logger.warning("Will proceed with standard endpoint")
        # Fallback to standard endpoint if acceleration fails
        s3 = boto3.client('s3',
                      region_name=SPACES_REGION,
                      endpoint_url=SPACES_ENDPOINT,
                      aws_access_key_id=SPACES_KEY,
                      aws_secret_access_key=SPACES_SECRET,
                      config=s3_config)

# Create login template
@app.route('/login', methods=['GET', 'POST'])
def login():
    error = None
    if request.method == 'POST':
        if request.form['password'] == APP_PASSWORD:
            session['logged_in'] = True
            return redirect(url_for('index'))
        else:
            error = 'Invalid password. Please try again.'
    return '''
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Login - Digital Ocean Folder Uploader</title>
            <link rel="stylesheet" href="/style.css">
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.2.1/css/all.min.css">
            <style>
                .login-container {
                    max-width: 400px;
                    margin: 100px auto;
                    padding: 30px;
                    background-color: white;
                    border-radius: 10px;
                    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
                    text-align: center;
                }
                .login-form {
                    margin-top: 20px;
                }
                .login-form input[type="password"] {
                    width: 100%;
                    padding: 12px;
                    margin: 10px 0;
                    border: 1px solid var(--border-color);
                    border-radius: 5px;
                    font-size: 16px;
                }
                .error-message {
                    color: var(--error-color);
                    margin-bottom: 15px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="login-container">
                    <h1 style="color: var(--primary-color);">Folder Uploader</h1>
                    <p>Please enter the password to access this tool</p>
                    
                    <form class="login-form" method="post">

                        <div>
                            <input type="password" name="password" placeholder="Enter password" required autofocus>
                        </div>
                        <button type="submit" class="btn">
                            <i class="fas fa-sign-in-alt"></i> Login
                        </button>
                    </form>
                </div>
            </div>
        </body>
        </html>
    '''.replace('{% if error %}', '' if error is None else '<div class="error-message">' + error + '</div>')

# Check if user is logged in
def login_required(f):
    def decorated_function(*args, **kwargs):
        if not session.get('logged_in'):
            # Check if this is an API request
            if request.path.startswith('/api/'):
                return jsonify({
                    'error': 'Session expired. Please login again.',
                    'success': False,
                    'status': 'unauthorized'
                }), 401
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    decorated_function.__name__ = f.__name__
    return decorated_function

@app.route('/')
@login_required
def index():
    """Serve the main page"""
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/style.css')
def serve_css():
    """Serve the CSS file"""
    return send_from_directory(app.static_folder, 'style.css')

@app.route('/app.js')
def serve_js():
    """Serve the JavaScript file"""
    return send_from_directory(app.static_folder, 'app.js')

def retry_with_backoff(func, *args, max_retries=5, initial_backoff=1, **kwargs):
    """
    Retry a function call with exponential backoff
    
    Args:
        func: Function to retry
        *args: Arguments for the function
        max_retries: Maximum number of retries
        initial_backoff: Initial backoff time in seconds
        **kwargs: Keyword arguments for the function
        
    Returns:
        Result of the function call
    """
    retries = 0
    backoff = initial_backoff
    
    while True:
        try:
            return func(*args, **kwargs)
        except (botocore.exceptions.ClientError, 
                botocore.exceptions.ConnectionError, 
                botocore.exceptions.ConnectTimeoutError,
                OSError) as e:
            
            retries += 1
            if retries > max_retries:
                logger.error(f"Max retries reached ({max_retries}). Giving up.")
                raise
            
            # Check if the error is retriable
            if isinstance(e, botocore.exceptions.ClientError):
                error_code = e.response.get('Error', {}).get('Code', '')
                if error_code in ['RequestTimeout', 'InternalError', 'ServiceUnavailable', 
                                   'SlowDown', 'ThrottlingException', 'RequestLimitExceeded']:
                    # Retriable error
                    pass
                else:
                    # Non-retriable error
                    raise
                    
            # Calculate 
            jitter = random.uniform(0, 0.1 * backoff)
            sleep_time = backoff + jitter
            
            logger.warning(f"Retrying operation. Attempt {retries}/{max_retries} "
                          f"after sleeping for {sleep_time:.2f}s. Error: {str(e)}")
            
            time.sleep(sleep_time)
            
            # Exponential backoff with extremely high cap
            backoff = min(backoff * 2, 3600)  # Cap at 1 hour instead of 60 seconds

@app.route('/api/upload', methods=['POST'])
@login_required
def upload_file():
    """
    Handle direct streaming multipart upload to DigitalOcean Spaces with no temp files.
    Implements robust retry logic for each part with extended timeouts for very large files.
    Uses S3 Transfer Acceleration for faster uploads over long distances.
    
    Expects:
    - A file in the 'file' field
    - 'filepath' field indicating the target path in the bucket
    """
    try:
        # Start timing the upload
        start_time = time.time()
        
        logger.info("Upload request received")
        
        if 'file' not in request.files:
            logger.error("No file part in the request")
            return jsonify({'error': 'No file part', 'success': False}), 400
        
        upload_file = request.files['file']
        if upload_file.filename == '':
            logger.error("No selected file (empty filename)")
            return jsonify({'error': 'No selected file', 'success': False}), 400
        
        # Get the filepath in the bucket (preserve folder structure)
        filepath = request.form.get('filepath', upload_file.filename)
        logger.info(f"Preparing to upload: {filepath} (size: {upload_file.content_length if hasattr(upload_file, 'content_length') else 'unknown'})")
        
        # Generate a unique ID for this upload for tracking
        upload_id = str(uuid.uuid4())
        
        # For very large files, use the optimized transfer config with acceleration
        file_size = request.content_length
        use_optimized = file_size and file_size > 100 * 1024 * 1024  # Use optimized for files over 100MB
        
        if use_optimized and USE_ACCELERATION:
            logger.info(f"Using optimized transfer with acceleration for large file: {filepath} ({formatSize(file_size)})")
            # Set up multipart upload parameters
            try:
                # Use boto3's managed upload with our optimized transfer config
                upload_file.seek(0)  # Ensure we're at the start of the file
                
                # Use retry_with_backoff for the upload_fileobj operation
                retry_with_backoff(
                    s3.upload_fileobj,
                    upload_file,  # Fileobj
                    SPACES_BUCKET,  # Bucket
                    filepath,  # Key
                    Config=transfer_config,  # Config with optimized parameters
                    max_retries=30,  # Extremely high retry count
                    initial_backoff=10  # Very long initial backoff
                )
                
                elapsed = time.time() - start_time
                logger.info(f"Accelerated upload completed: {filepath} (ID: {upload_id}) in {elapsed:.2f} seconds")
                
                return jsonify({
                    'success': True,
                    'message': f'File uploaded successfully as {filepath}',
                    'filepath': filepath,
                    'upload_id': upload_id,
                    'time_seconds': elapsed,
                    'accelerated': True
                })
            except Exception as e:
                logger.error(f"Accelerated upload failed: {str(e)}")
                logger.error("Falling back to manual streaming upload")
                # Fall through to standard streaming upload
        
        # Standard streaming upload with manual part management (fallback or for smaller files)
        # Initialize multipart upload with retry
        try:
            mpu = retry_with_backoff(
                s3.create_multipart_upload,
                Bucket=SPACES_BUCKET,
                Key=filepath,
                max_retries=30,  # Extremely high retry count for initialization
                initial_backoff=5  # Longer initial backoff
            )
            multipart_upload_id = mpu["UploadId"]
            logger.info(f"Multipart upload initiated with ID: {multipart_upload_id}")
        except Exception as e:
            logger.error(f"Failed to initiate multipart upload: {str(e)}")
            return jsonify({
                'error': f"Failed to initiate upload: {str(e)}",
                'filepath': filepath,
                'upload_id': upload_id,
                'success': False
            }), 500
        
        # Track parts
        parts = []
        part_number = 1
        
        # Stream the file directly to S3 in larger chunks for better efficiency with very large files
        chunk_size = 100 * 1024 * 1024  # 100MB chunks (optimized for terabyte-scale uploads)
        upload_file.seek(0)  # Reset to beginning of file
        chunk = upload_file.read(chunk_size)
        
        failed_parts = 0
        retried_parts = 0
        
        while chunk:
            # Upload the part directly from memory with retry logic
            logger.info(f"Uploading part {part_number} for {filepath}")
            
            try:
                # Retry the upload_part operation with backoff
                part = retry_with_backoff(
                    s3.upload_part,
                    Body=chunk,
                    Bucket=SPACES_BUCKET,
                    Key=filepath,
                    PartNumber=part_number,
                    UploadId=multipart_upload_id,
                    max_retries=30,  # Extremely high retry count for parts
                    initial_backoff=5  # Longer initial backoff
                )
                
                # Track the part
                parts.append({
                    'PartNumber': part_number,
                    'ETag': part['ETag']
                })
                
            except Exception as e:
                failed_parts += 1
                logger.error(f"Failed to upload part {part_number} after retries: {str(e)}")
                # If any part fails, the upload should be considered failed
                # Abort the upload and return error immediately rather than continuing
                raise Exception(f"Failed to upload part {part_number}: {str(e)}")
            
            # Get next chunk
            chunk = upload_file.read(chunk_size)
            part_number += 1
            
            # Log progress periodically
            if part_number % 10 == 0:
                elapsed = time.time() - start_time
                logger.info(f"Upload progress: {part_number-1} parts uploaded for {filepath} in {elapsed:.2f} seconds")
        
        # Complete the multipart upload - only if ALL parts succeeded
        if parts:  # Only complete if we have parts
            try:
                retry_with_backoff(
                    s3.complete_multipart_upload,
                    Bucket=SPACES_BUCKET,
                    Key=filepath,
                    UploadId=multipart_upload_id,
                    MultipartUpload={'Parts': parts},
                    max_retries=30,  # Extremely high retry count for completion
                    initial_backoff=10  # Even longer initial backoff for completion
                )
                
                elapsed = time.time() - start_time
                logger.info(f"Multipart streaming upload completed: {filepath} (ID: {upload_id}) in {elapsed:.2f} seconds")
                
                # All parts succeeded, upload is complete
                return jsonify({
                    'success': True,
                    'message': f'File uploaded successfully as {filepath}',
                    'filepath': filepath,
                    'upload_id': upload_id,
                    'parts': len(parts),
                    'time_seconds': elapsed
                })
            except Exception as e:
                logger.error(f"Failed to complete multipart upload: {str(e)}")
                # Failure during completion is still a failure
                raise
        else:
            # No parts were successfully uploaded - this should never happen now that we abort on first part failure
            raise Exception("No parts were successfully uploaded")
        
    except Exception as e:
        logger.error(f"Upload failed: {str(e)}")
        logger.exception("Detailed error information:")
        return jsonify({
            'error': str(e),
            'success': False,
            'status': 'error'
        }), 500

# Helper function to format file sizes
def formatSize(size_bytes):
    """Format bytes into a human-readable form"""
    if size_bytes is None:
        return "unknown size"
    
    units = ['B', 'KB', 'MB', 'GB', 'TB']
    unit_index = 0
    size = float(size_bytes)
    
    while size >= 1024 and unit_index < len(units) - 1:
        size /= 1024
        unit_index += 1
        
    return f"{size:.2f} {units[unit_index]}"

@app.route('/api/health', methods=['GET'])
def health_check():
    """Simple health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'timestamp': time.time(),
        'bucket': SPACES_BUCKET,
        'region': SPACES_REGION
    })

@app.route('/logout')
def logout():
    """Logout user by clearing session"""
    session.pop('logged_in', None)
    return redirect(url_for('login'))

if __name__ == '__main__':
    # Get port from environment variable or default to 5000
    port = int(os.getenv('PORT', 5000))
    
    # Only run debug mode in development
    debug = os.getenv('FLASK_ENV') == 'development'
    
    # Log startup information
    logger.info(f"Starting server with bucket: {SPACES_BUCKET}")
    logger.info(f"Running in {'development' if debug else 'production'} mode")
    
    # Start the server
    app.run(host='0.0.0.0', port=port, debug=debug) 