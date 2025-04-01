document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const uploadArea = document.getElementById('upload-area');
    const folderInput = document.getElementById('folder-input');
    const selectBtn = document.getElementById('select-btn');
    const uploadBtn = document.getElementById('upload-btn');
    const cancelBtn = document.getElementById('cancel-btn');
    const uploadControls = document.getElementById('upload-controls');
    const uploadList = document.getElementById('upload-list');
    const summary = document.getElementById('summary');
    
    // Metadata form elements
    const userInput = document.getElementById('user-input');
    const cameraInput = document.getElementById('camera-input');
    const dateInput = document.getElementById('date-input');
    const taskInput = document.getElementById('task-input');
    
    // Set today's date as default
    dateInput.valueAsDate = new Date();
    
    // Add a new button for adding more folders
    const addMoreBtn = document.createElement('button');
    addMoreBtn.id = 'add-more-btn';
    addMoreBtn.className = 'btn';
    addMoreBtn.style.backgroundColor = 'var(--secondary-color)';
    addMoreBtn.style.marginLeft = '10px';
    addMoreBtn.innerHTML = '<i class="fas fa-plus"></i> Add More Folders';
    addMoreBtn.style.display = 'none';
    
    // Insert the button after the cancel button
    cancelBtn.parentNode.insertBefore(addMoreBtn, cancelBtn.nextSibling);
    
    // Check if directory selection is supported
    const isDirectoryUploadSupported = 'webkitdirectory' in folderInput || 'directory' in folderInput || 'mozdirectory' in folderInput;
    
    // If folder upload isn't supported, show a message
    if (!isDirectoryUploadSupported) {
        console.warn('Directory selection not fully supported in this browser');
        // Update the button text to indicate individual file selection is an option
        selectBtn.textContent = "Select Files";
        document.querySelector('#upload-area h3').textContent = "Drag & Drop Files Here";
        document.querySelector('#upload-area p').textContent = "Folder selection may not be supported in your browser";
    }
    
    // Summary stats elements
    const totalFiles = document.getElementById('total-files');
    const totalSize = document.getElementById('total-size');
    const uploadedFiles = document.getElementById('uploaded-files');
    const failedFiles = document.getElementById('failed-files');
    
    // Store selected files
    let selectedFiles = [];
    let queuedFolders = []; // Track queued folders for better UI feedback
    let totalBytes = 0;
    let activeUploads = 0;
    let completedUploads = 0;
    let failedUploads = 0;
    let cancelUpload = false;
    
    // Support drag and drop
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('drag-over');
    });
    
    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('drag-over');
    });
    
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('drag-over');
        
        // Get only folders/files from drop event
        const items = e.dataTransfer.items;
        let folderAdded = false;
        
        for (let i = 0; i < items.length; i++) {
            const item = items[i].webkitGetAsEntry();
            if (item) {
                if (item.isDirectory) {
                    folderAdded = true;
                    // Add to queued folders array
                    queuedFolders.push(item.name);
                }
                traverseFileTree(item);
            }
        }
        
        if (folderAdded) {
            // Show the "Add More Folders" button when folders are added
            addMoreBtn.style.display = 'inline-block';
        }
    });
    
    // Click to select folder
    selectBtn.addEventListener('click', () => {
        console.log('Select button clicked');
        folderInput.click();
    });
    
    // Add more folders button
    addMoreBtn.addEventListener('click', () => {
        console.log('Add more folders clicked');
        folderInput.value = ''; // Clear previous selection
        folderInput.click();
    });
    
    folderInput.addEventListener('change', (event) => {
        console.log('Folder input changed');
        console.log('Files selected:', event.target.files.length);
        
        if (event.target.files.length > 0) {
            const firstFile = event.target.files[0];
            console.log('First file path:', firstFile.webkitRelativePath);
            
            // Extract folder name from path
            const folderPath = firstFile.webkitRelativePath.split('/');
            if (folderPath.length > 0) {
                queuedFolders.push(folderPath[0]);
                console.log('Added folder to queue:', folderPath[0]);
            }
            
            // Show the "Add More Folders" button
            addMoreBtn.style.display = 'inline-block';
            
            handleSelectedFiles(folderInput.files);
        }
    });
    
    // Start upload
    uploadBtn.addEventListener('click', () => {
        // Validate metadata first
        if (validateMetadata()) {
            startUpload();
        }
    });
    
    // Validate required metadata fields
    function validateMetadata() {
        let isValid = true;
        
        // Remove any previous error messages
        document.querySelectorAll('.invalid-feedback').forEach(el => el.remove());
        document.querySelectorAll('.metadata-required').forEach(el => el.classList.remove('metadata-required'));
        
        // Validate User
        if (!userInput.value.trim()) {
            markInvalid(userInput, 'User is required');
            isValid = false;
        }
        
        // Validate Camera
        if (!cameraInput.value.trim()) {
            markInvalid(cameraInput, 'Camera is required');
            isValid = false;
        }
        
        // Validate Date
        if (!dateInput.value) {
            markInvalid(dateInput, 'Date is required');
            isValid = false;
        }
        
        // Validate Task
        if (!taskInput.value.trim()) {
            markInvalid(taskInput, 'Task is required');
            isValid = false;
        }
        
        return isValid;
    }
    
    // Mark a field as invalid with error message
    function markInvalid(inputElement, message) {
        inputElement.classList.add('metadata-required');
        
        const errorDiv = document.createElement('div');
        errorDiv.className = 'invalid-feedback';
        errorDiv.textContent = message;
        
        inputElement.parentNode.appendChild(errorDiv);
    }
    
    // Cancel upload
    cancelBtn.addEventListener('click', () => {
        cancelUpload = true;
        uploadBtn.disabled = false;
        cancelBtn.disabled = true;
        cancelBtn.textContent = 'Canceling...';
    });
    
    // Handle files selected via input
    function handleSelectedFiles(files) {
        console.log('Handling selected files:', files ? files.length : 0);
        
        if (!files || files.length === 0) {
            console.warn('No files selected');
            return;
        }
        
        // Append to existing selection rather than replacing
        const newFiles = Array.from(files);
        
        // Check if these are files from a folder (should have webkitRelativePath)
        // If not, they're individual files
        const hasRelativePaths = newFiles.some(file => file.webkitRelativePath && file.webkitRelativePath.length > 0);
        console.log('Files have relative paths:', hasRelativePaths);
        
        if (!hasRelativePaths) {
            // For individual files without folder structure, add a simple path
            newFiles.forEach(file => {
                file.webkitRelativePath = file.name;
            });
        }
        
        // Add the new files to our selection
        selectedFiles = [...selectedFiles, ...newFiles];
        
        if (selectedFiles.length > 0) {
            // Calculate total size
            totalBytes = selectedFiles.reduce((total, file) => total + file.size, 0);
            
            // Show files in the UI
            displaySelectedFiles();
            
            // Update summary
            updateSummary();
            
            // Show upload controls - MAKE SURE THESE ARE VISIBLE
            uploadControls.style.display = 'block';
            uploadList.style.display = 'block';
            summary.style.display = 'block';
            
            // Add visual indicator that user should click Start Upload
            if (!document.getElementById('upload-prompt')) {
                const prompt = document.createElement('div');
                prompt.id = 'upload-prompt';
                prompt.style.textAlign = 'center';
                prompt.style.marginTop = '10px';
                prompt.style.color = 'var(--primary-color)';
                prompt.style.fontWeight = 'bold';
                prompt.innerHTML = '👆 Click "Start Upload" to begin the upload process';
                uploadControls.after(prompt);
            }
            
            // Update the prompt text to show queued folders
            if (queuedFolders.length > 0 && document.getElementById('upload-prompt')) {
                const prompt = document.getElementById('upload-prompt');
                prompt.innerHTML = `👆 ${queuedFolders.length} folder${queuedFolders.length > 1 ? 's' : ''} queued. Click "Start Upload" to begin, or add more folders.`;
            }
            
            // Highlight the upload button with a pulsing effect
            uploadBtn.classList.add('pulse-animation');
            
            console.log('Upload controls are now visible. Ready to start upload.');
            console.log(`Total queued folders: ${queuedFolders.length}`);
        }
    }
    
    // Display selected files in the UI with efficient grouping for large file sets
    function displaySelectedFiles() {
        uploadList.innerHTML = '';
        
        // Group files by directory for better organization
        const filesByDirectory = {};
        const fileStats = {
            totalCount: selectedFiles.length,
            totalSize: totalBytes,
            typeStats: {} // Will hold counts by file type
        };
        
        // Process files
        selectedFiles.forEach(file => {
            // Extract relative path
            const path = file.webkitRelativePath;
            const directories = path.split('/');
            const fileName = directories.pop();
            const directoryPath = directories.join('/');
            
            // Group by top directory
            const topDir = directories.length > 0 ? directories[0] : '(root)';
            if (!filesByDirectory[topDir]) {
                filesByDirectory[topDir] = {
                    files: [],
                    totalSize: 0,
                    count: 0
                };
            }
            
            filesByDirectory[topDir].files.push(file);
            filesByDirectory[topDir].totalSize += file.size;
            filesByDirectory[topDir].count++;
            
            // Track file types
            const fileExtension = fileName.split('.').pop().toLowerCase();
            if (!fileStats.typeStats[fileExtension]) {
                fileStats.typeStats[fileExtension] = {
                    count: 0,
                    size: 0
                };
            }
            fileStats.typeStats[fileExtension].count++;
            fileStats.typeStats[fileExtension].size += file.size;
        });
        
        // Display directory summary for large numbers of files
        if (Object.keys(filesByDirectory).length > 0) {
            const summaryHeader = document.createElement('div');
            summaryHeader.className = 'folder-summary-header';
            
            // Show queue status in the header
            let queueText = '';
            if (queuedFolders.length > 1) {
                queueText = `<div class="queued-folders-note">${queuedFolders.length} folders queued for upload</div>`;
            }
            
            summaryHeader.innerHTML = `
                <h3>Upload Queue Summary</h3>
                <p>Total: ${fileStats.totalCount.toLocaleString()} files (${formatFileSize(fileStats.totalSize)})</p>
                ${queueText}
            `;
            uploadList.appendChild(summaryHeader);
            
            // Create directory summaries
            Object.keys(filesByDirectory).forEach(dir => {
                const dirData = filesByDirectory[dir];
                const dirItem = document.createElement('div');
                dirItem.className = 'upload-item directory-header';
                
                // Determine icon for folder
                let folderIcon = 'fa-folder';
                // Check content type to use appropriate icon
                if (dirData.files.some(f => f.type.startsWith('video/'))) {
                    folderIcon = 'fa-film';
                } else if (dirData.files.some(f => f.type.startsWith('image/'))) {
                    folderIcon = 'fa-images';
                } else if (dirData.files.some(f => f.type.includes('json'))) {
                    folderIcon = 'fa-code';
                }
                
                // Add a queue position indicator for better UX
                const queuePosition = queuedFolders.indexOf(dir) + 1;
                const queueIndicator = queuePosition > 0 ? 
                    `<span class="queue-position">#${queuePosition} in queue</span>` : '';
                
                dirItem.innerHTML = `
                    <i class="fas ${folderIcon} file-icon"></i>
                    <div class="file-info">
                        <div class="file-name">${dir}/ ${queueIndicator}</div>
                        <div class="file-path">${dirData.count.toLocaleString()} files (${formatFileSize(dirData.totalSize)})</div>
                        <div class="progress-container">
                            <div class="progress-bar">
                                <div class="progress-bar-fill dir-${dir.replace(/\W/g, '_')}" style="width: 0%"></div>
                            </div>
                        </div>
                        <div class="upload-status status-pending">Pending</div>
                    </div>
                `;
                uploadList.appendChild(dirItem);
            });
            
            // Add file type summary 
            const typeHeader = document.createElement('div');
            typeHeader.className = 'file-type-summary';
            
            let typeContent = '<h4>File Types</h4><div class="file-type-grid">';
            Object.keys(fileStats.typeStats).forEach(ext => {
                const typeData = fileStats.typeStats[ext];
                typeContent += `
                    <div class="file-type-item">
                        <span class="file-type-label">.${ext}</span>
                        <span class="file-type-count">${typeData.count} files</span>
                        <span class="file-type-size">${formatFileSize(typeData.size)}</span>
                    </div>
                `;
            });
            typeContent += '</div>';
            
            typeHeader.innerHTML = typeContent;
            uploadList.appendChild(typeHeader);
        }
    }
    
    // Create a list item for a file
    function createFileListItem(file) {
        const item = document.createElement('div');
        item.className = 'upload-item';
        item.dataset.path = file.webkitRelativePath;
        
        // Determine icon based on file type
        let icon = 'fa-file';
        if (file.type.startsWith('image/')) icon = 'fa-file-image';
        else if (file.type.startsWith('video/')) icon = 'fa-file-video';
        else if (file.type.startsWith('audio/')) icon = 'fa-file-audio';
        else if (file.type.startsWith('text/')) icon = 'fa-file-alt';
        else if (file.type.includes('json')) icon = 'fa-file-code';
        
        const formattedSize = formatFileSize(file.size);
        
        item.innerHTML = `
            <i class="fas ${icon} file-icon"></i>
            <div class="file-info">
                <div class="file-name">${file.name}</div>
                <div class="file-path">${file.webkitRelativePath}</div>
                <div class="file-size">${formattedSize}</div>
                <div class="progress-container">
                    <div class="progress-bar">
                        <div class="progress-bar-fill" style="width: 0%"></div>
                    </div>
                </div>
                <div class="upload-status status-pending">Pending</div>
            </div>
        `;
        
        return item;
    }
    
    // Recursively traverse files in dropped folders
    function traverseFileTree(item, path = '') {
        if (item.isFile) {
            item.file(file => {
                // Preserve the relative path
                file.webkitRelativePath = path + file.name;
                selectedFiles.push(file);
                
                // Update UI after adding file
                totalBytes += file.size;
                displaySelectedFiles();
                updateSummary();
                uploadControls.style.display = 'block';
                uploadList.style.display = 'block';
                summary.style.display = 'block';
            });
        } else if (item.isDirectory) {
            const dirReader = item.createReader();
            dirReader.readEntries(entries => {
                for (let i = 0; i < entries.length; i++) {
                    traverseFileTree(entries[i], path + item.name + '/');
                }
            });
        }
    }
    
    // Start uploading files
    async function startUpload() {
        if (selectedFiles.length === 0) return;
        
        uploadBtn.disabled = true;
        cancelUpload = false;
        
        // Remove the pulse animation
        uploadBtn.classList.remove('pulse-animation');
        
        // Hide the "Add More Folders" button during upload
        addMoreBtn.style.display = 'none';
        
        // Remove the prompt if it exists
        const prompt = document.getElementById('upload-prompt');
        if (prompt) {
            prompt.remove();
        }
        
        // Set initial state for directory progress bars
        const dirItems = uploadList.querySelectorAll('.directory-header');
        dirItems.forEach(item => {
            const status = item.querySelector('.upload-status');
            if (status) {
                status.className = 'upload-status status-pending';
                status.textContent = 'Pending';
            }
            
            const progressBar = item.querySelector('.progress-bar-fill');
            if (progressBar) {
                progressBar.style.width = '0%';
            }
        });
        
        completedUploads = 0;
        failedUploads = 0;
        activeUploads = 0;
        updateSummary();
        
        // Get metadata values
        const user = userInput.value.trim();
        const camera = cameraInput.value.trim();
        const date = dateInput.value;
        const task = taskInput.value.trim();
        
        // Format date as YYYY-MM-DD
        const formattedDate = date;
        
        // Create base path: User_Camera
        const basePath = `${user}_${camera}`;
        
        // Log metadata
        console.log('Upload metadata:', {
            user,
            camera,
            date: formattedDate,
            task,
            basePath
        });
        
        // Update UI to show the target path
        const metadataForm = document.getElementById('metadata-form');
        if (metadataForm && !document.getElementById('target-path-info')) {
            const pathInfo = document.createElement('div');
            pathInfo.id = 'target-path-info';
            pathInfo.className = 'target-path-info';
            pathInfo.innerHTML = `
                <div class="info-box">
                    <i class="fas fa-info-circle"></i>
                    <span>Folders will be uploaded to: <strong>${basePath}/[Task]_[Date]_[FolderName]/[original files]</strong></span>
                </div>
            `;
            metadataForm.appendChild(pathInfo);
        }
        
        // Use the queuedFolders array to determine upload order
        let folderUploadOrder = [...queuedFolders];
        
        // Add any directories that might be in the selection but not in queuedFolders
        const allTopDirs = new Set();
        selectedFiles.forEach(file => {
            const path = file.webkitRelativePath;
            const directories = path.split('/');
            const topDir = directories.length > 0 ? directories[0] : '(root)';
            allTopDirs.add(topDir);
        });
        
        // Ensure all directories are in the upload order
        Array.from(allTopDirs).forEach(dir => {
            if (!folderUploadOrder.includes(dir)) {
                folderUploadOrder.push(dir);
            }
        });
        
        // Group files by directory (preserves the original structure)
        const filesByDirectory = {};
        selectedFiles.forEach(file => {
            const path = file.webkitRelativePath;
            const directories = path.split('/');
            const topDir = directories.length > 0 ? directories[0] : '(root)';
            
            if (!filesByDirectory[topDir]) {
                filesByDirectory[topDir] = {
                    files: [],
                    completed: 0,
                    failed: 0,
                    totalBytes: 0,
                    uploadedBytes: 0
                };
            }
            
            filesByDirectory[topDir].files.push(file);
            filesByDirectory[topDir].totalBytes += file.size;
        });
        
        const MAX_CONCURRENT_UPLOADS = 3;
        let activeDirs = 0;
        
        // Use ordered array instead of a queue object
        const directoryQueue = [...folderUploadOrder]
            .filter(dir => filesByDirectory[dir]) // Only include directories that have files
            .map(dir => ({ 
                name: dir, 
                status: 'pending',
                details: filesByDirectory[dir]
            }));
        
        console.log(`Starting upload with ${directoryQueue.length} directories in queue`);
        
        // Process directories one by one
        async function processDirectories() {
            if (cancelUpload) {
                console.log('Upload canceled by user');
                // Reset UI after cancel
                uploadBtn.disabled = false;
                cancelBtn.disabled = false;
                cancelBtn.textContent = 'Cancel';
                addMoreBtn.style.display = 'inline-block';
                return;
            }
            
            if (directoryQueue.length === 0 && activeDirs === 0) {
                // All uploads completed
                console.log('All uploads completed');
                uploadBtn.disabled = false;
                cancelBtn.disabled = false;
                cancelBtn.textContent = 'Cancel';
                
                // Show add more button again if we want to queue more folders
                addMoreBtn.style.display = 'inline-block';
                return;
            }
            
            // Find pending directories
            const pendingDirs = directoryQueue.filter(dir => dir.status === 'pending');
            
            // Start up to MAX_CONCURRENT_UPLOADS directories
            while (pendingDirs.length > 0 && activeDirs < MAX_CONCURRENT_UPLOADS) {
                const dirInfo = pendingDirs.shift();
                dirInfo.status = 'active';
                activeDirs++;
                
                console.log(`Starting upload for directory: ${dirInfo.name}`);
                
                // Process this directory
                await processDirectory(dirInfo.name, dirInfo.details, {
                    basePath,
                    task,
                    date: formattedDate
                })
                    .then(() => {
                        dirInfo.status = 'completed';
                        console.log(`Completed upload for directory: ${dirInfo.name}`);
                    })
                    .catch(err => {
                        dirInfo.status = 'failed';
                        console.error(`Failed upload for directory: ${dirInfo.name}`, err);
                    })
                    .finally(() => {
                        activeDirs--;
                        processDirectories();
                    });
            }
        }
        
        // Process all files in a directory
        async function processDirectory(dirName, dirData, metadata) {
            console.log(`Processing directory: ${dirName} with ${dirData.files.length} files`);
            console.log(`Using metadata:`, metadata);
            
            // Find the directory item in the UI using our text content search helper
            const dirElement = findElementContainingText('.directory-header .file-name', `${dirName}/`);
            if (!dirElement) {
                console.error(`No UI element found for directory: ${dirName}`);
                return Promise.resolve(); // Continue with other directories
            }
            
            const dirItem = dirElement.closest('.directory-header');
            if (!dirItem) {
                console.error(`Could not find parent directory header for: ${dirName}`);
                return Promise.resolve();
            }
            
            // Add visual indicator that this directory is being processed
            dirItem.classList.add('uploading');
            
            const statusElement = dirItem.querySelector('.upload-status');
            const progressBar = dirItem.querySelector('.progress-bar-fill');
            
            statusElement.className = 'upload-status status-uploading';
            statusElement.textContent = `Uploading... 0%`;
            
            // Concurrency for files within a directory
            const MAX_CONCURRENT_FILES = 2;
            let activeFiles = 0;
            const fileQueue = [...dirData.files];
            let dirCompleted = 0;
            let dirFailed = 0;
            let dirUploadedBytes = 0;
            
            return new Promise((resolveDir) => {
                function processFiles() {
                    if (cancelUpload) {
                        statusElement.className = 'upload-status status-canceled';
                        statusElement.textContent = 'Canceled';
                        dirItem.classList.remove('uploading');
                        resolveDir();
                        return;
                    }
                    
                    if (fileQueue.length === 0 && activeFiles === 0) {
                        // Directory completed
                        dirItem.classList.remove('uploading');
                        
                        if (dirFailed > 0) {
                            // Don't use "Completed with errors" - be explicit about failure
                            statusElement.className = 'upload-status status-error';
                            statusElement.textContent = `Failed (${dirFailed} files could not be uploaded)`;
                        } else {
                            statusElement.className = 'upload-status status-success';
                            statusElement.textContent = 'Completed successfully';
                        }
                        
                        // Ensure progress bar is at 100%
                        progressBar.style.width = '100%';
                        
                        resolveDir();
                        return;
                    }
                    
                    while (fileQueue.length > 0 && activeFiles < MAX_CONCURRENT_FILES && !cancelUpload) {
                        const file = fileQueue.shift();
                        activeFiles++;
                        
                        // Update status to show current file
                        statusElement.textContent = `Uploading ${file.name}...`;
                        
                        // Upload file with metadata
                        uploadFile(file, metadata)
                            .then(result => {
                                if (result.success) {
                                    dirCompleted++;
                                    completedUploads++;
                                } else {
                                    dirFailed++;
                                    failedUploads++;
                                    // Log the exact error to help with troubleshooting
                                    console.error(`File upload failed: ${file.name}, Error: ${result.error || 'Unknown error'}`);
                                }
                                
                                dirUploadedBytes += file.size;
                                
                                // Update directory progress
                                const dirProgress = Math.round((dirUploadedBytes / dirData.totalBytes) * 100);
                                progressBar.style.width = `${dirProgress}%`;
                                
                                const filesCompleted = dirCompleted + dirFailed;
                                const filesTotal = dirData.files.length;
                                
                                // Update status text to be more descriptive
                                if (dirFailed > 0) {
                                    statusElement.className = 'upload-status status-warning';
                                    statusElement.textContent = `Uploading... ${filesCompleted}/${filesTotal} (${dirFailed} failed)`;
                                } else {
                                    statusElement.textContent = `Uploading... ${filesCompleted}/${filesTotal} (${dirProgress}%)`;
                                }
                                
                                updateSummary();
                            })
                            .finally(() => {
                                activeFiles--;
                                processFiles();
                            });
                    }
                }
                
                // Start processing files in this directory
                processFiles();
            });
        }
        
        // Start processing directories
        processDirectories();
    }
    
    // Upload a single file
    async function uploadFile(file, metadata, retryCount = 0) {
        const MAX_RETRIES = 5;  // Maximum number of retries
        const RETRY_DELAY = 2000;  // Delay between retries in milliseconds
        
        // Extract filename and original relative path
        const originalRelativePath = file.webkitRelativePath;
        
        // Split the path into components
        const pathComponents = originalRelativePath.split('/');
        
        // Get the top directory and the rest of the path
        const originalTopDir = pathComponents[0];
        const remainingPath = pathComponents.slice(1).join('/');
        
        // Create the new top directory name using metadata
        // Format: Task_Date_OriginalTopDir
        const newTopDir = `${metadata.task}_${metadata.date}_${originalTopDir}`;
        
        // Create the full new path: User_Camera/Task_Date_OriginalTopDir/rest/of/path
        const newFilePath = remainingPath 
            ? `${metadata.basePath}/${newTopDir}/${remainingPath}`
            : `${metadata.basePath}/${newTopDir}`;
        
        console.log(`Starting upload for file: ${originalRelativePath} (Attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);
        console.log(`Target path: ${newFilePath}`);
        
        try {
            // Create FormData
            const formData = new FormData();
            formData.append('file', file);
            formData.append('filepath', newFilePath);
            
            console.log(`Preparing XHR request for: ${newFilePath}`);
            
            // Upload with progress tracking
            const response = await uploadWithProgress(formData, (progress) => {
                // Progress is handled at the directory level
            });
            
            console.log(`Upload response for ${newFilePath}:`, response);
            
            if (response.success) {
                console.log(`Upload successful for: ${newFilePath}`);
                return { success: true };
            } else {
                console.error(`Upload returned error for: ${newFilePath}`, response.error);
                throw new Error(response.error || 'Upload failed');
            }
        } catch (error) {
            console.error(`Upload failed for: ${newFilePath}`, error);
            
            // Check if we should retry
            if (retryCount < MAX_RETRIES) {
                console.log(`Retrying upload in ${RETRY_DELAY/1000} seconds...`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
                return uploadFile(file, metadata, retryCount + 1);
            } else {
                console.error(`Max retries (${MAX_RETRIES}) reached for: ${newFilePath}`);
                return { success: false, error: error.message };
            }
        }
    }
    
    // Upload with progress tracking
    async function uploadWithProgress(formData, progressCallback) {
        console.log('Starting uploadWithProgress');
        
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            
            xhr.upload.addEventListener('progress', (event) => {
                if (event.lengthComputable) {
                    const progress = Math.round((event.loaded / event.total) * 100);
                    console.log(`Upload progress: ${progress}%`);
                    if (progressCallback) {
                        progressCallback(progress);
                    }
                }
            });
            
            xhr.addEventListener('load', () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        const response = JSON.parse(xhr.responseText);
                        console.log('Upload complete, response:', response);
                        resolve(response);
                    } catch (e) {
                        console.error('Error parsing JSON response:', e);
                        reject(new Error('Invalid server response'));
                    }
                } else {
                    console.error(`HTTP error status: ${xhr.status}`);
                    let errorMessage = `Server error (${xhr.status})`;
                    
                    // Try to parse error response
                    try {
                        const response = JSON.parse(xhr.responseText);
                        if (response.error) {
                            errorMessage = response.error;
                        }
                    } catch (e) {
                        // Use text response if JSON parsing fails
                        if (xhr.responseText) {
                            errorMessage = xhr.responseText;
                        }
                    }
                    
                    reject(new Error(errorMessage));
                }
            });
            
            xhr.addEventListener('error', () => {
                console.error('XHR network error');
                reject(new Error('Network error during upload - check internet connection'));
            });
            
            xhr.addEventListener('abort', () => {
                console.warn('XHR aborted');
                reject(new Error('Upload aborted'));
            });
            
            xhr.addEventListener('timeout', () => {
                console.error('XHR timeout - server may still be processing the upload');
                reject(new Error('Upload timed out waiting for server response - the server may still be processing the upload'));
            });
            
            console.log('Opening XHR connection to /api/upload');
            xhr.open('POST', '/api/upload', true);
            
            // Set an extremely long timeout that will never be hit
            // Note: This doesn't affect the actual upload time, only waiting for a response
            xhr.timeout = 86400000; // 24 hours - ridiculously long to never hit
            
            console.log('Sending XHR request');
            xhr.send(formData);
            
            // Handle cancel
            if (cancelUpload) {
                console.warn('Canceling upload');
                xhr.abort();
            }
        });
    }
    
    // Update summary display
    function updateSummary() {
        totalFiles.textContent = selectedFiles.length;
        totalSize.textContent = formatFileSize(totalBytes);
        uploadedFiles.textContent = completedUploads;
        failedFiles.textContent = failedUploads;
        
        // Update the UI to show if there are any failures
        const summaryElement = document.getElementById('summary');
        
        if (failedUploads > 0) {
            // Add a visual indicator if there are failures
            if (!summaryElement.classList.contains('has-failures')) {
                summaryElement.classList.add('has-failures');
            }
            
            // Add retry button if needed (for future implementation)
            if (completedUploads + failedUploads === selectedFiles.length) {
                const retryContainer = document.getElementById('retry-container');
                if (!retryContainer) {
                    const container = document.createElement('div');
                    container.id = 'retry-container';
                    container.style.textAlign = 'center';
                    container.style.marginTop = '15px';
                    container.innerHTML = `
                        <div class="upload-error-message">
                            <i class="fas fa-exclamation-triangle"></i> 
                            Some files failed to upload. Check the console for details.
                        </div>
                    `;
                    summaryElement.appendChild(container);
                }
            }
        } else {
            summaryElement.classList.remove('has-failures');
            const retryContainer = document.getElementById('retry-container');
            if (retryContainer) {
                retryContainer.remove();
            }
        }
    }
    
    // Format file size to human-readable string
    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    // Helper function to find elements with text content containing a string
    // This mimics jQuery's :contains selector
    function findElementContainingText(selector, text) {
        const elements = document.querySelectorAll(selector);
        for (let i = 0; i < elements.length; i++) {
            if (elements[i].textContent.includes(text)) {
                return elements[i];
            }
        }
        return null;
    }
}); 