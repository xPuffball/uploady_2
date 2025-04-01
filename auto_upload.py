#!/usr/bin/env python3
import os
import sys
import time
import argparse
import logging
import boto3
import random
import uuid
import botocore.exceptions
from boto3.s3.transfer import TransferConfig
from dotenv import load_dotenv

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('upload_log.txt')
    ]
)
logger = logging.getLogger(__name__)

def format_size(size_bytes):
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
                    
            # Calculate jitter
            jitter = random.uniform(0, 0.1 * backoff)
            sleep_time = backoff + jitter
            
            logger.warning(f"Retrying operation. Attempt {retries}/{max_retries} "
                          f"after sleeping for {sleep_time:.2f}s. Error: {str(e)}")
            
            time.sleep(sleep_time)
            
            # Exponential backoff with high cap
            backoff = min(backoff * 2, 3600)  # Cap at 1 hour

def get_s3_client():
    """Initialize and return an S3 client with the appropriate configuration"""
    # Load environment variables
    load_dotenv()
    
    # DigitalOcean Spaces credentials
    spaces_key = os.getenv('DO_SPACES_KEY')
    spaces_secret = os.getenv('DO_SPACES_SECRET')
    spaces_region = os.getenv('DO_SPACES_REGION', 'nyc3')
    spaces_endpoint = os.getenv('DO_SPACES_ENDPOINT', f'https://{spaces_region}.digitaloceanspaces.com')
    spaces_bucket = os.getenv('DO_SPACES_BUCKET')
    
    # Check if credentials are set
    if not all([spaces_key, spaces_secret, spaces_bucket]):
        logger.error("Missing DigitalOcean Spaces credentials in .env file")
        sys.exit(1)
    
    # Configure S3 client with increased retries and timeouts
    s3_config = boto3.session.Config(
        retries={
            'max_attempts': 10,
            'mode': 'adaptive',
        },
        connect_timeout=86400,     # 24 hours
        read_timeout=86400,        # 24 hours
        max_pool_connections=30
    )
    
    # Determine if we should use acceleration endpoint
    use_acceleration = os.getenv('USE_ACCELERATION', 'True').lower() in ('true', 'yes', '1')
    
    # Set the endpoint based on acceleration setting
    if use_acceleration:
        endpoint_url = f'https://{spaces_bucket}.s3-accelerate.amazonaws.com'
        logger.info(f"Using S3 Transfer Acceleration endpoint: {endpoint_url}")
    else:
        endpoint_url = spaces_endpoint
        logger.info(f"Using standard S3 endpoint: {endpoint_url}")
    
    # Create S3 client
    s3 = boto3.client('s3',
                      region_name=spaces_region,
                      endpoint_url=endpoint_url,
                      aws_access_key_id=spaces_key,
                      aws_secret_access_key=spaces_secret,
                      config=s3_config)
    
    # Enable transfer acceleration on the bucket if needed
    if use_acceleration:
        try:
            logger.info(f"Checking Transfer Acceleration status for bucket: {spaces_bucket}")
            acceleration_status = s3.get_bucket_accelerate_configuration(Bucket=spaces_bucket)
            current_status = acceleration_status.get('Status', 'None')
            
            if current_status != 'Enabled':
                logger.info(f"Enabling Transfer Acceleration for bucket: {spaces_bucket}")
                s3.put_bucket_accelerate_configuration(
                    Bucket=spaces_bucket,
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
                          region_name=spaces_region,
                          endpoint_url=spaces_endpoint,
                          aws_access_key_id=spaces_key,
                          aws_secret_access_key=spaces_secret,
                          config=s3_config)
    
    return s3, spaces_bucket

def upload_file(s3, bucket, local_path, s3_path):
    """Upload a single file to S3 with retry logic"""
    logger.info(f"Uploading {local_path} to {s3_path}")
    
    # Create a transfer config with increased timeouts for larger files
    transfer_config = TransferConfig(
        multipart_threshold=10 * 1024 * 1024,  # 10MB
        max_concurrency=10,
        multipart_chunksize=25 * 1024 * 1024,  # 25MB chunks
        use_threads=True,
        max_io_queue=100,
        io_chunksize=262144     # 256KB chunks for reading
    )
    
    file_size = os.path.getsize(local_path)
    logger.info(f"File size: {format_size(file_size)}")
    
    try:
        start_time = time.time()
        
        # Use retry_with_backoff for the upload_file operation
        retry_with_backoff(
            s3.upload_file,
            local_path,  # Filename
            bucket,      # Bucket
            s3_path,     # Key
            Config=transfer_config,  # Config with optimized parameters
            max_retries=30,  # High retry count
            initial_backoff=5  # Longer initial backoff
        )
        
        elapsed = time.time() - start_time
        logger.info(f"Upload completed: {s3_path} in {elapsed:.2f} seconds ({format_size(file_size/elapsed)}/s)")
        return True
    except Exception as e:
        logger.error(f"Upload failed for {local_path}: {str(e)}")
        return False

def upload_directory(s3, bucket, local_dir, metadata):
    """Upload an entire directory to S3 with the specified metadata"""
    # Extract metadata
    user = metadata['user']
    camera = metadata['camera']
    task = metadata['task']
    date = metadata['date']
    
    # Create base path: User_Camera
    base_path = f"{user}_{camera}"
    
    # Create the new top directory name using metadata
    # Format: Task_Date_OriginalTopDir
    dir_name = os.path.basename(local_dir)
    new_top_dir = f"{task}_{date}_{dir_name}"
    
    # Full target path in S3
    target_path = f"{base_path}/{new_top_dir}"
    
    logger.info(f"Uploading directory: {local_dir}")
    logger.info(f"Target S3 path: {target_path}")
    
    # Count files and calculate total size
    total_files = 0
    total_size = 0
    file_list = []
    
    for root, _, files in os.walk(local_dir):
        for file in files:
            local_file_path = os.path.join(root, file)
            
            # Skip hidden files
            if file.startswith('.'):
                continue
                
            # Calculate relative path from the directory being uploaded
            rel_path = os.path.relpath(local_file_path, local_dir)
            s3_file_path = f"{target_path}/{rel_path}"
            
            file_size = os.path.getsize(local_file_path)
            total_size += file_size
            total_files += 1
            
            file_list.append({
                'local_path': local_file_path,
                's3_path': s3_file_path,
                'size': file_size
            })
    
    logger.info(f"Found {total_files} files to upload (Total: {format_size(total_size)})")
    
    # Upload files
    uploaded_files = 0
    failed_files = 0
    uploaded_size = 0
    
    for i, file_info in enumerate(file_list):
        logger.info(f"[{i+1}/{total_files}] Uploading: {file_info['local_path']}")
        
        success = upload_file(
            s3, 
            bucket, 
            file_info['local_path'], 
            file_info['s3_path']
        )
        
        if success:
            uploaded_files += 1
            uploaded_size += file_info['size']
            logger.info(f"Progress: {uploaded_files}/{total_files} files ({format_size(uploaded_size)}/{format_size(total_size)})")
        else:
            failed_files += 1
            logger.error(f"Failed to upload: {file_info['local_path']}")
    
    # Summary
    logger.info(f"Directory upload complete: {local_dir}")
    logger.info(f"Uploaded: {uploaded_files}/{total_files} files")
    logger.info(f"Failed: {failed_files} files")
    logger.info(f"Total size: {format_size(uploaded_size)}/{format_size(total_size)}")
    
    return {
        'success': failed_files == 0,
        'uploaded_files': uploaded_files,
        'failed_files': failed_files,
        'total_files': total_files,
        'uploaded_size': uploaded_size,
        'total_size': total_size
    }

def main():
    # Parse command line arguments
    parser = argparse.ArgumentParser(description='Automatically upload directories to S3')
    parser.add_argument('--user', required=True, help='User name for metadata')
    parser.add_argument('--camera', required=True, help='Camera name for metadata')
    parser.add_argument('--task', required=True, help='Task name for metadata')
    parser.add_argument('--date', default=time.strftime('%Y-%m-%d'), help='Date for metadata (YYYY-MM-DD format, defaults to today)')
    parser.add_argument('--dirs', nargs='*', help='Specific directories to upload (defaults to all directories in script location)')
    args = parser.parse_args()
    
    # Validate date format
    try:
        time.strptime(args.date, '%Y-%m-%d')
    except ValueError:
        logger.error("Date must be in YYYY-MM-DD format")
        sys.exit(1)
    
    # Get S3 client
    s3, bucket = get_s3_client()
    
    # Metadata for uploads
    metadata = {
        'user': args.user,
        'camera': args.camera,
        'task': args.task,
        'date': args.date
    }
    
    logger.info(f"Starting automatic directory upload with metadata:")
    logger.info(f"  User: {metadata['user']}")
    logger.info(f"  Camera: {metadata['camera']}")
    logger.info(f"  Task: {metadata['task']}")
    logger.info(f"  Date: {metadata['date']}")
    
    # Get script directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    
    # Get directories to upload
    if args.dirs:
        # Use specified directories
        dirs_to_upload = []
        for dir_name in args.dirs:
            dir_path = os.path.join(script_dir, dir_name)
            if os.path.isdir(dir_path):
                dirs_to_upload.append(dir_path)
            else:
                logger.warning(f"Skipping {dir_name} - not a directory")
    else:
        # Find all directories in the script location
        dirs_to_upload = [
            os.path.join(script_dir, d) for d in os.listdir(script_dir)
            if os.path.isdir(os.path.join(script_dir, d)) and not d.startswith('.')
        ]
    
    if not dirs_to_upload:
        logger.error("No directories found to upload")
        sys.exit(1)
    
    logger.info(f"Found {len(dirs_to_upload)} directories to upload:")
    for dir_path in dirs_to_upload:
        logger.info(f"  - {os.path.basename(dir_path)}")
    
    # Upload each directory
    results = []
    for dir_path in dirs_to_upload:
        dir_name = os.path.basename(dir_path)
        logger.info(f"\n{'='*80}\nProcessing directory: {dir_name}\n{'='*80}")
        
        result = upload_directory(s3, bucket, dir_path, metadata)
        results.append({
            'directory': dir_name,
            'result': result
        })
    
    # Print summary
    logger.info("\n\n===== UPLOAD SUMMARY =====")
    total_uploaded = 0
    total_failed = 0
    
    for result in results:
        dir_name = result['directory']
        upload_result = result['result']
        
        status = "SUCCESS" if upload_result['success'] else "FAILED"
        logger.info(f"{dir_name}: {status} - {upload_result['uploaded_files']}/{upload_result['total_files']} files uploaded")
        
        total_uploaded += upload_result['uploaded_files']
        total_failed += upload_result['failed_files']
    
    logger.info(f"\nTotal files uploaded: {total_uploaded}")
    logger.info(f"Total files failed: {total_failed}")
    
    if total_failed > 0:
        logger.warning("Some files failed to upload. Check the log for details.")
        return 1
    else:
        logger.info("All files uploaded successfully!")
        return 0

if __name__ == "__main__":
    sys.exit(main()) 